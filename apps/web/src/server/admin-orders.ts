import 'server-only';
/**
 * 관리자 주문 서버 서비스 (F-ADM-ORD-01~06, F-ADM-DSP-06). 호출하는 서버 액션·페이지가 먼저 requirePermission/requireScreen 으로 권한을 확인하고,
 * 거점 범위(BR-102)는 여기서 branchFilter 로 일괄 적용한다.
 */
import type { manualOrderInput, orderUpdateInput, z } from '@aircon/contracts';
import {
  bookSlots,
  branch,
  customer,
  customerAddress,
  holiday,
  orderChangeRequest,
  orderItem,
  orderStatusHistory,
  payment,
  refund,
  releaseSlots,
  serviceOrder,
} from '@aircon/db';
import {
  type BranchFilter,
  type QuoteSnapshotItem,
  applyVisitSurcharge,
  assertChangeRequestTransition,
  assertOrderTransition,
  hourToTime,
  maskName,
  maskPhone,
  orderStatusHistoryRow,
  slotHoursFor,
} from '@aircon/domain';
import { and, asc, desc, eq, gte, inArray, isNull, like, lte, or, type SQL } from 'drizzle-orm';
import { UserError } from './action-result';
import { createCustomer, findCustomerByPhone, upsertVisitAddress } from './customers';
import { getDb } from './db';
import { notifyOrder } from './notify';
import {
  type Actor,
  type OrderRow,
  type Tx,
  cancelOrder,
  isUniqueViolation,
  itemNames,
  nextOrderNo,
  orderSlotTarget,
  scheduleColumns,
} from './orders';
import { decrypt, encrypt, phoneHash } from './pii';
import { computeQuote, findServiceArea, loadQuoteCatalog } from './quote';
import { isQuoteDemoMode } from './quote-demo';

/** 일정 변경이 가능한 상태 (기사 출발 전) */
export const RESCHEDULABLE_STATUSES = ['QUOTED', 'RECEIVED', 'ASSIGN_WAIT', 'ASSIGNED'];

export function branchCond(filter: BranchFilter, col = serviceOrder.branchId): SQL | undefined {
  if (filter.kind === 'BRANCH') return eq(col, filter.branchId);
  if (filter.kind === 'NONE') return eq(col, -1);
  return undefined;
}

/* ---------- A-ORD-010 주문 목록 ---------- */

export interface OrderListQuery {
  dateFrom: string | null;
  dateTo: string | null;
  status: string | null;
  channel: string | null;
  keyword: string | null;
}

export async function listOrders(filter: BranchFilter, q: OrderListQuery, limit = 500) {
  const kw = q.keyword?.replace(/\s/g, '') ?? '';
  const digits = kw.replace(/-/g, '');
  const kwCond =
    kw === ''
      ? undefined
      : /^01\d{8,9}$/.test(digits)
        ? eq(customer.phone1Hash, phoneHash(digits))
        : or(like(serviceOrder.orderNo, `%${kw.toUpperCase()}%`), like(customer.customerNo, `%${kw.toUpperCase()}%`));
  const rows = await getDb()
    .select({
      id: serviceOrder.id,
      orderNo: serviceOrder.orderNo,
      status: serviceOrder.status,
      channel: serviceOrder.channel,
      orderType: serviceOrder.orderType,
      promisedAt: serviceOrder.promisedAt,
      totalAmount: serviceOrder.totalAmount,
      paymentStatus: serviceOrder.paymentStatus,
      createdAt: serviceOrder.createdAt,
      branchName: branch.name,
      customerNo: customer.customerNo,
      name: customer.name,
      phone: customer.phone1,
      roadAddress: customerAddress.roadAddress,
    })
    .from(serviceOrder)
    .innerJoin(branch, eq(branch.id, serviceOrder.branchId))
    .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
    .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
    .where(
      and(
        isNull(serviceOrder.deletedAt),
        branchCond(filter),
        q.dateFrom ? gte(serviceOrder.requestedDate, q.dateFrom) : undefined,
        q.dateTo ? lte(serviceOrder.requestedDate, q.dateTo) : undefined,
        q.status ? eq(serviceOrder.status, q.status) : undefined,
        q.channel ? eq(serviceOrder.channel, q.channel) : undefined,
        kwCond,
      ),
    )
    .orderBy(desc(serviceOrder.createdAt))
    .limit(limit);
  // 목록은 항상 마스킹 (BR-100)
  return rows.map(({ name, phone, ...r }) => ({
    ...r,
    customerName: maskName(decrypt(name)),
    phoneMasked: maskPhone(decrypt(phone)),
  }));
}

/** CSV 다운로드용 (원문 연락처 포함 — 호출 전 EXPORT 권한·감사 로그) */
export async function exportOrders(filter: BranchFilter, q: OrderListQuery) {
  const rows = await listOrders(filter, q, 5000);
  return rows;
}

/* ---------- A-ORD-020 주문 상세 ---------- */

async function loadOrder(id: number, filter: BranchFilter): Promise<OrderRow> {
  const [o] = await getDb()
    .select()
    .from(serviceOrder)
    .where(and(eq(serviceOrder.id, id), isNull(serviceOrder.deletedAt), branchCond(filter)));
  if (!o) throw new UserError('주문을 찾을 수 없거나 조회 권한이 없습니다.');
  return o;
}

export async function getOrderDetail(id: number, filter: BranchFilter) {
  const db = getDb();
  const [row] = await db
    .select({ order: serviceOrder, branchName: branch.name, c: customer, a: customerAddress })
    .from(serviceOrder)
    .innerJoin(branch, eq(branch.id, serviceOrder.branchId))
    .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
    .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
    .where(and(eq(serviceOrder.id, id), isNull(serviceOrder.deletedAt), branchCond(filter)));
  if (!row) return null;
  const [items, history, requests, payments] = await Promise.all([
    db.select().from(orderItem).where(eq(orderItem.orderId, id)).orderBy(asc(orderItem.id)),
    db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id)).orderBy(asc(orderStatusHistory.createdAt)),
    db.select().from(orderChangeRequest).where(eq(orderChangeRequest.orderId, id)).orderBy(desc(orderChangeRequest.createdAt)),
    db.select().from(payment).where(eq(payment.orderId, id)).orderBy(asc(payment.createdAt)),
  ]);
  const refunds = payments.length
    ? await db
        .select()
        .from(refund)
        .where(
          inArray(
            refund.paymentId,
            payments.map((p) => p.id),
          ),
        )
        .orderBy(asc(refund.createdAt))
    : [];
  const name = await itemNames(row.order.quoteId);
  return {
    order: row.order,
    branchName: row.branchName,
    customer: {
      id: row.c.id,
      customerNo: row.c.customerNo,
      nameMasked: maskName(decrypt(row.c.name)),
      phoneMasked: maskPhone(decrypt(row.c.phone1)),
      customerType: row.c.customerType,
      grade: row.c.grade,
    },
    address: {
      roadAddress: row.a.roadAddress,
      housingType: row.a.housingType,
      hasElevator: row.a.hasElevator,
      parkingNote: row.a.parkingNote,
    },
    items: items.map((i) => ({ ...i, name: name(i) })),
    history,
    requests,
    payments,
    refunds,
  };
}

/** [보기] 원문 열람 (호출 전 감사 로그 기록) */
export async function revealOrderPii(id: number, filter: BranchFilter) {
  const [row] = await getDb()
    .select({ name: customer.name, phone: customer.phone1, detail: customerAddress.detailAddress })
    .from(serviceOrder)
    .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
    .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
    .where(and(eq(serviceOrder.id, id), branchCond(filter)));
  if (!row) throw new UserError('주문을 찾을 수 없거나 조회 권한이 없습니다.');
  return { name: decrypt(row.name) ?? '', phone: decrypt(row.phone) ?? '', detailAddress: decrypt(row.detail) ?? '' };
}

/* ---------- 일정 변경 (F-ADM-ORD-03 · F-ADM-ORD-05 승인) ---------- */

/** 주문 항목 → 할증 재판단용 스냅샷 (총 대수 = 상품 수량 합) */
function itemsAsSnapshot(items: (typeof orderItem.$inferSelect)[], ruleCodeOf: (id: number | null) => string | undefined) {
  return {
    items: items.map(
      (i): QuoteSnapshotItem => ({
        itemType: i.itemType as QuoteSnapshotItem['itemType'],
        productId: i.productId,
        optionId: i.optionId,
        surchargeRuleId: i.surchargeRuleId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        amount: i.amount,
        name: '',
        ruleCode: ruleCodeOf(i.surchargeRuleId),
      }),
    ),
    totalUnits: items.filter((i) => i.itemType === 'PRODUCT').reduce((s, i) => s + i.quantity, 0),
  };
}

/**
 * 방문 일시 변경: 기존 슬롯 반환 → 새 슬롯 차감(BR-021) → 일정 컬럼 갱신.
 * 아직 결제 전이면 새 일시로 야간·휴일 할증을 다시 판단한다(BR-012). 결제 후에는 금액을 바꾸지 않는다.
 */
async function rescheduleInTx(tx: Tx, o: OrderRow, slotDate: string, slotHour: number, actor: Actor) {
  if (!RESCHEDULABLE_STATUSES.includes(o.status)) throw new UserError('기사 출발 이후에는 일정을 바꿀 수 없습니다.');
  const old = orderSlotTarget(o);
  const durationHours = old ? old.hours.length : 1;
  if (old) await releaseSlots(tx, old);
  const durationMin = durationHours >= 2 ? durationHours * 60 : 60;
  const hours = slotHoursFor(slotHour, durationMin);
  if (!(await bookSlots(tx, { branchId: o.branchId, slotDate, hours, units: o.requiredTechCount }))) {
    throw new UserError('선택한 시간에 남은 자리가 없습니다. 다른 시간을 골라 주세요.');
  }
  const set: Partial<typeof serviceOrder.$inferInsert> = { ...scheduleColumns(slotDate, slotHour, durationMin) };
  if (o.paymentStatus === 'UNPAID') {
    const [items, catalog] = await Promise.all([tx.select().from(orderItem).where(eq(orderItem.orderId, o.id)), loadQuoteCatalog()]);
    const ruleCode = (id: number | null) => catalog.surchargeRules.find((r) => r.id === id)?.ruleCode;
    const holidays = isQuoteDemoMode() ? [] : await holidayList(tx, slotDate);
    const p = applyVisitSurcharge({
      snapshot: itemsAsSnapshot(items, ruleCode),
      rules: catalog.surchargeRules,
      visit: { date: slotDate, time: hourToTime(slotHour) },
      holidays,
    });
    const timeItems = items.filter((i) => i.itemType === 'SURCHARGE' && ['NIGHT', 'HOLIDAY'].includes(ruleCode(i.surchargeRuleId) ?? ''));
    if (timeItems.length) await tx.delete(orderItem).where(inArray(orderItem.id, timeItems.map((i) => i.id)));
    const added = p.items.filter((i) => i.itemType === 'SURCHARGE' && (i.ruleCode === 'NIGHT' || i.ruleCode === 'HOLIDAY'));
    if (added.length) {
      await tx.insert(orderItem).values(
        added.map((i) => ({
          orderId: o.id,
          itemType: i.itemType,
          productId: null,
          optionId: null,
          surchargeRuleId: i.surchargeRuleId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          amount: i.amount,
        })),
      );
    }
    Object.assign(set, {
      surchargeAmount: p.surchargeAmount,
      totalAmount: p.totalAmount + o.extraAmount,
      visitType: p.timeRule?.ruleCode ?? 'IN_HOURS',
    });
  }
  await tx
    .update(serviceOrder)
    .set({ ...set, updatedAt: new Date(), updatedBy: actor.id })
    .where(eq(serviceOrder.id, o.id));
}

async function holidayList(tx: Tx, date: string) {
  const rows = await tx.select({ d: holiday.holidayDate }).from(holiday).where(eq(holiday.holidayDate, date));
  return rows.map((r) => r.d);
}

/** F-ADM-ORD-03 주문 수정: 방문 일시·요청사항·내부 메모·상세주소 */
export async function updateOrder(input: z.output<typeof orderUpdateInput>, filter: BranchFilter, actor: Actor) {
  const o = await loadOrder(input.orderId, filter);
  if (o.status === 'CANCELED' || o.status === 'COMPLETED') throw new UserError('완료·취소된 주문은 수정할 수 없습니다.');
  const newSchedule =
    input.slotDate !== null &&
    input.slotHour !== null &&
    (input.slotDate !== o.requestedDate || `${hourToTime(input.slotHour)}:00` !== o.requestedTimeFrom);
  await getDb().transaction(async (tx) => {
    if (newSchedule) await rescheduleInTx(tx, o, input.slotDate!, input.slotHour!, actor);
    await tx
      .update(serviceOrder)
      .set({ customerRequest: input.customerRequest, internalNote: input.internalNote, updatedAt: new Date(), updatedBy: actor.id })
      .where(eq(serviceOrder.id, o.id));
    if (input.detailAddress) {
      await tx
        .update(customerAddress)
        .set({ detailAddress: encrypt(input.detailAddress), updatedAt: new Date(), updatedBy: actor.id })
        .where(eq(customerAddress.id, o.addressId));
    }
  });
  if (newSchedule) await notifyOrder('ORDER_CHANGED', o.id);
}

/** F-ADM-ORD-04 관리자 취소: 결제 금액 전액 환불(수수료 없음) */
export async function cancelOrderByAdmin(orderId: number, reasonCode: string, memo: string | null, filter: BranchFilter, actor: Actor) {
  const o = await loadOrder(orderId, filter);
  return cancelOrder(o, { reasonCode, memo, refundAmount: o.paidAmount, fee: 0, changeRequest: false }, actor);
}

/* ---------- A-ORD-030 변경·취소 요청 ---------- */

export async function listChangeRequests(filter: BranchFilter, status: string | null) {
  const rows = await getDb()
    .select({
      id: orderChangeRequest.id,
      orderId: serviceOrder.id,
      orderNo: serviceOrder.orderNo,
      orderStatus: serviceOrder.status,
      branchName: branch.name,
      requestType: orderChangeRequest.requestType,
      requestedDate: orderChangeRequest.requestedDate,
      requestedTime: orderChangeRequest.requestedTime,
      promisedAt: serviceOrder.promisedAt,
      reason: orderChangeRequest.reason,
      status: orderChangeRequest.status,
      createdAt: orderChangeRequest.createdAt,
      handledAt: orderChangeRequest.handledAt,
      name: customer.name,
    })
    .from(orderChangeRequest)
    .innerJoin(serviceOrder, eq(serviceOrder.id, orderChangeRequest.orderId))
    .innerJoin(branch, eq(branch.id, serviceOrder.branchId))
    .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
    .where(and(branchCond(filter), status ? eq(orderChangeRequest.status, status) : undefined))
    .orderBy(desc(orderChangeRequest.createdAt))
    .limit(500);
  return rows.map(({ name, ...r }) => ({ ...r, customerName: maskName(decrypt(name)) }));
}

/** F-ADM-ORD-05 요청 승인·반려. 일정 변경 승인은 슬롯을 옮기고 변경 알림을 보낸다 */
export async function handleChangeRequest(requestId: number, decision: 'APPROVED' | 'REJECTED', filter: BranchFilter, actor: Actor) {
  const db = getDb();
  const [r] = await db.select().from(orderChangeRequest).where(eq(orderChangeRequest.id, requestId));
  if (!r) throw new UserError('요청을 찾을 수 없습니다.');
  assertChangeRequestTransition(r.status, decision);
  const o = await loadOrder(r.orderId, filter);
  if (decision === 'APPROVED' && r.requestType === 'CANCEL') {
    await cancelOrder(o, { reasonCode: 'CUSTOMER_REQUEST', memo: r.reason, refundAmount: o.paidAmount, fee: 0, changeRequest: false }, actor);
  }
  await db.transaction(async (tx) => {
    if (decision === 'APPROVED' && r.requestType === 'RESCHEDULE') {
      if (!r.requestedDate || !r.requestedTime) throw new UserError('요청한 일정이 없습니다.');
      await rescheduleInTx(tx, o, r.requestedDate, Number(r.requestedTime.slice(0, 2)), actor);
    }
    const done = await tx
      .update(orderChangeRequest)
      .set({ status: decision, handledBy: actor.id, handledAt: new Date(), updatedAt: new Date(), updatedBy: actor.id })
      .where(and(eq(orderChangeRequest.id, r.id), eq(orderChangeRequest.status, 'REQUESTED')))
      .returning({ id: orderChangeRequest.id });
    if (done.length === 0) throw new UserError('이미 처리된 요청입니다.');
  });
  if (decision === 'APPROVED' && r.requestType === 'RESCHEDULE') await notifyOrder('ORDER_CHANGED', o.id);
}

/* ---------- A-ORD-040 수동 접수 ---------- */

/**
 * F-ADM-ORD-06 전화·방문 접수: 고객 찾기/등록 → 공용 견적 모듈로 금액 산출(방문 일시 할증 포함) → 주문 RECEIVED + 슬롯 차감 → 접수 알림.
 * 중복 접수(BR-020)는 호출한 쪽이 먼저 확인하고 duplicateConfirmed 로 넘긴다.
 */
export async function createManualOrder(input: z.output<typeof manualOrderInput>, filter: BranchFilter, actor: Actor, now = new Date()) {
  const area = await findServiceArea(input.address.legalDongCode);
  if (!area.serviceable || !area.branchId) throw new UserError('서비스 지역이 아닙니다.');
  if (filter.kind === 'NONE' || (filter.kind === 'BRANCH' && filter.branchId !== area.branchId))
    throw new UserError('다른 거점 관할 주소는 접수할 수 없습니다.');
  const r = await computeQuote(
    {
      legalDongCode: input.address.legalDongCode,
      lines: input.lines,
      options: input.options,
      customerType: input.customerType,
      visit: { date: input.slotDate, time: hourToTime(input.slotHour) },
    },
    now,
  );
  if (!r.ok) throw new UserError(r.reason === 'NO_LINES' ? '기기는 필수 입력값입니다.' : '견적을 산출할 수 없습니다. 상품·가격 등록을 확인하세요.');

  let customerId = input.customerId;
  if (!customerId) {
    if (!input.phone || !input.name) throw new UserError('고객 이름과 연락처는 필수 입력값입니다.');
    customerId = (await findCustomerByPhone(input.phone))?.id ?? null;
    customerId ??= await createCustomer(
      {
        name: input.name,
        phone: input.phone,
        joinChannel: 'PHONE',
        authProvider: null,
        authProviderKey: null,
        consents: null,
        customerType: input.customerType,
        actorId: actor.id,
      },
      now,
    );
  }
  const timeRule = r.snapshot.items.find((i) => i.itemType === 'SURCHARGE' && (i.ruleCode === 'NIGHT' || i.ruleCode === 'HOLIDAY'));
  const sched = scheduleColumns(input.slotDate, input.slotHour, r.estimatedDurationMin);
  const hours = slotHoursFor(input.slotHour, r.estimatedDurationMin);
  const db = getDb();
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await db.transaction(async (tx) => {
        const addressId = await upsertVisitAddress(
          tx,
          customerId!,
          {
            zipcode: input.address.zipcode,
            roadAddress: input.address.roadAddress,
            jibunAddress: input.address.jibunAddress,
            legalDongCode: input.address.legalDongCode,
            detailAddress: input.detailAddress,
            housingType: input.housingType,
            hasElevator: input.hasElevator,
            parkingNote: input.parkingNote,
            branchId: area.branchId!,
          },
          actor.id,
        );
        const orderNo = await nextOrderNo(tx, now, attempt);
        assertOrderTransition(null, 'RECEIVED');
        const [o] = await tx
          .insert(serviceOrder)
          .values({
            orderNo,
            customerId: customerId!,
            addressId,
            branchId: area.branchId!,
            channel: input.channel,
            orderType: input.orderType,
            status: 'RECEIVED',
            ...sched,
            visitType: timeRule?.ruleCode ?? 'IN_HOURS',
            requiredTechCount: 1,
            customerRequest: input.customerRequest,
            internalNote: input.internalNote,
            subtotalAmount: r.subtotalAmount,
            discountAmount: r.discountAmount,
            surchargeAmount: r.surchargeAmount,
            totalAmount: r.totalAmount,
            paymentStatus: 'UNPAID',
            isDuplicateChecked: true,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning({ id: serviceOrder.id });
        await tx.insert(orderItem).values(r.items.map((i) => ({ ...i, orderId: o!.id })));
        await tx
          .insert(orderStatusHistory)
          .values(orderStatusHistoryRow({ orderId: o!.id, from: null, to: 'RECEIVED', actorType: actor.type, actorId: actor.id }));
        if (!(await bookSlots(tx, { branchId: area.branchId!, slotDate: input.slotDate, hours, units: 1 }))) {
          throw new UserError('선택한 시간에 남은 자리가 없습니다. 다른 시간을 골라 주세요.');
        }
        return { id: o!.id, orderNo };
      });
      await notifyOrder('ORDER_CONFIRMED', out.id);
      return out;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) continue;
      throw e;
    }
  }
}
