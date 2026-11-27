import 'server-only';
/**
 * 주문(예약) 서버 서비스 — 고객 예약·결제·조회·변경·취소 (F-CUS-RSV-01~05, F-CUS-PAY-01, F-CUS-ORD-01~03, F-CUS-NTF-01).
 * - 상태 변경은 transitionOrder() 하나로만 한다: 도메인 전이 검사(assertOrderTransition) + 조건부 UPDATE + order_status_history 1행.
 * - 슬롯 차감은 같은 트랜잭션에서 조건부 UPDATE(bookSlots, BR-021). 실패하면 전체를 되돌린다.
 * - 결제·환불은 INSERT ONLY: PG 확인 결과를 최종 상태로 1행씩 남긴다.
 */
import { customerQuoteInput, type ReservationInput } from '@aircon/contracts';
import {
  assignment,
  bookSlots,
  branch,
  customer,
  customerAddress,
  holiday,
  notificationLog,
  notificationTemplate,
  orderChangeRequest,
  orderItem,
  orderStatusHistory,
  payment,
  quote,
  refund,
  releaseSlots,
  serviceOrder,
  technician,
} from '@aircon/db';
import {
  type ActorType,
  type OrderStatus,
  type QuoteSnapshot,
  ACTIVE_ORDER_STATUSES,
  CONFIRMED_ASSIGN_STATUSES,
  SETTING_KEYS,
  addressKey,
  applyVisitSurcharge,
  assertOrderTransition,
  assertQuoteTransition,
  canCustomerCancel,
  cancelPolicy,
  findDuplicateOrders,
  formatOrderNo,
  hourToTime,
  isQuoteExpired,
  kstToday,
  orderStatusHistoryRow,
  paymentStatusAfterRefund,
  slotDates,
  slotHoursFor,
  slotsNeeded,
} from '@aircon/domain';
import { MOCK_PAYMENT_PREFIX, createPaymentGateway } from '@aircon/integrations';
import { and, desc, eq, gte, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { UserError } from './action-result';
import type { CurrentCustomer } from './customer-session';
import { upsertVisitAddress } from './customers';
import { getDb } from './db';
import { restoreCouponOnCancel } from './coupons';
import { copyQuoteDevices } from './devices';
import { notifyOrder } from './notify';
import { decrypt, phoneHash } from './pii';
import { computeQuote, findServiceArea, getQuoteByNo, loadQuoteCatalog } from './quote';
import { DEMO_HOLIDAYS, DEMO_QUOTE_NO, decodeDemoRequest, isQuoteDemoMode } from './quote-demo';
import { getSettingNumber } from './settings';

type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type OrderRow = typeof serviceOrder.$inferSelect;

/** 체험 모드 예약 결과 (저장하지 않음) */
export const DEMO_ORDER_NO = 'demo';

/* ---------- 공통: 상태 전이 ---------- */

export interface Actor {
  type: ActorType;
  id: number | null;
}

/** 주문 상태 변경의 유일한 경로: 전이 검사 → 조건부 UPDATE(동시 처리 방지) → 상태 이력 1행 INSERT */
export async function transitionOrder(
  tx: Tx,
  o: Pick<OrderRow, 'id' | 'status'>,
  to: OrderStatus,
  actor: Actor,
  opts: { reasonCode?: string | null; memo?: string | null; set?: Partial<typeof serviceOrder.$inferInsert> } = {},
) {
  assertOrderTransition(o.status, to);
  const rows = await tx
    .update(serviceOrder)
    .set({ ...opts.set, status: to, updatedAt: new Date(), updatedBy: actor.id })
    .where(and(eq(serviceOrder.id, o.id), eq(serviceOrder.status, o.status)))
    .returning({ id: serviceOrder.id });
  if (rows.length === 0) throw new UserError('다른 곳에서 먼저 처리된 예약입니다. 새로고침 후 다시 확인해 주세요.');
  await tx.insert(orderStatusHistory).values(
    orderStatusHistoryRow({
      orderId: o.id,
      from: o.status as OrderStatus,
      to,
      actorType: actor.type,
      actorId: actor.id,
      reasonCode: opts.reasonCode ?? null,
      memo: opts.memo ?? null,
    }),
  );
}

/** 주문이 차지한 슬롯 (방문일 + 시작~종료 시각) */
export function orderSlotTarget(o: Pick<OrderRow, 'branchId' | 'requestedDate' | 'requestedTimeFrom' | 'requestedTimeTo' | 'requiredTechCount'>) {
  if (!o.requestedDate || !o.requestedTimeFrom || !o.requestedTimeTo) return null;
  const from = Number(o.requestedTimeFrom.slice(0, 2));
  const to = Number(o.requestedTimeTo.slice(0, 2));
  return {
    branchId: o.branchId,
    slotDate: o.requestedDate,
    hours: Array.from({ length: Math.max(to - from, 1) }, (_, i) => from + i),
    units: o.requiredTechCount,
  };
}

/** 방문 일시 → 주문 일정 컬럼 (약속 시각 = 시작 시각, 시작~종료 = 차지하는 슬롯) */
export function scheduleColumns(slotDate: string, slotHour: number, durationMin: number) {
  const need = slotsNeeded(durationMin);
  return {
    requestedDate: slotDate,
    requestedTimeFrom: `${hourToTime(slotHour)}:00`,
    requestedTimeTo: `${hourToTime(slotHour + need)}:00`,
    promisedAt: new Date(`${slotDate}T${hourToTime(slotHour)}:00+09:00`),
  };
}

/** 같은 시각에 이미 다른 주문이 번호를 받은 경우를 대비해 순번을 하나씩 올려 다시 시도한다 */
export async function nextOrderNo(tx: Tx, now: Date, bump = 0): Promise<string> {
  const prefix = formatOrderNo(now, 1).slice(0, 10);
  const [r] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(serviceOrder)
    .where(like(serviceOrder.orderNo, `${prefix}%`));
  return formatOrderNo(now, (r?.n ?? 0) + 1 + bump);
}

export const isUniqueViolation = (e: unknown) =>
  ((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === '23505';

/** 방문일의 공휴일 목록 (야간·휴일 할증 판단, BR-012) */
async function holidaysOn(date: string, db: Db | Tx = getDb()): Promise<string[]> {
  if (isQuoteDemoMode()) return [...DEMO_HOLIDAYS];
  const rows = await db.select({ d: holiday.holidayDate }).from(holiday).where(eq(holiday.holidayDate, date));
  return rows.map((r) => r.d);
}

/** 예약 일시를 반영한 금액: 견적 스냅샷 단가 + 방문 일시 야간·휴일 할증 1건 (BR-012·013·014) */
export async function priceForVisit(snapshot: Pick<QuoteSnapshot, 'items' | 'totalUnits'>, slotDate: string, slotHour: number) {
  const [catalog, holidays] = await Promise.all([loadQuoteCatalog(), holidaysOn(slotDate)]);
  return applyVisitSurcharge({
    snapshot,
    rules: catalog.surchargeRules,
    visit: { date: slotDate, time: hourToTime(slotHour) },
    holidays,
  });
}

/* ---------- 예약할 견적 (C-RSV-010) ---------- */

export interface ReservableQuote {
  id: number | null;
  quoteNo: string;
  branchId: number;
  legalDongCode: string;
  snapshot: QuoteSnapshot;
  totalAmount: number;
  durationMin: number;
  /** 예약할 수 없으면 사유 */
  blocked: string | null;
}

/** 견적 번호(체험 모드는 입력값)로 예약할 견적을 불러온다. 발행 상태 + 유효기간 안이어야 예약 가능(BR-015) */
export async function loadReservableQuote(quoteNo: string, demoRaw?: string | null, now = new Date()): Promise<ReservableQuote | null> {
  if (isQuoteDemoMode()) {
    if (quoteNo !== DEMO_QUOTE_NO) return null;
    const parsed = customerQuoteInput.safeParse(decodeDemoRequest(demoRaw ?? undefined));
    if (!parsed.success) return null;
    const r = await computeQuote({ ...parsed.data, customerType: 'PERSONAL', visit: null }, now);
    if (!r.ok) return null;
    return {
      id: null,
      quoteNo: DEMO_QUOTE_NO,
      branchId: r.branchId,
      legalDongCode: parsed.data.legalDongCode,
      snapshot: r.snapshot,
      totalAmount: r.totalAmount,
      durationMin: r.estimatedDurationMin,
      blocked: null,
    };
  }
  if (!/^Q\d{10}$/.test(quoteNo)) return null;
  const q = await getQuoteByNo(quoteNo);
  if (!q || !q.snapshot || !q.branchId || !q.legalDongCode) return null;
  const blocked =
    q.status === 'CONVERTED'
      ? '이미 예약한 견적입니다. 예약 내역에서 확인해 주세요.'
      : q.status !== 'ISSUED' || isQuoteExpired(q, now)
        ? '유효기간이 지난 견적입니다. 다시 견적을 받아 주세요.'
        : q.snapshot.needsSiteSurvey
          ? '현장 확인이 필요한 견적이라 온라인 예약을 할 수 없습니다. 고객센터로 연락해 주세요.'
          : null;
  return {
    id: q.id,
    quoteNo: q.quoteNo,
    branchId: q.branchId,
    legalDongCode: q.legalDongCode,
    snapshot: q.snapshot,
    totalAmount: q.totalAmount,
    durationMin: q.estimatedDurationMin ?? 60,
    blocked,
  };
}

/* ---------- BR-020 중복 접수 ---------- */

/**
 * 같은 연락처(전화번호 해시) 또는 같은 주소(도로명+상세)로 진행 중인 주문 (DUPLICATE_CHECK_DAYS 이내 접수).
 * 상세주소는 암호화돼 있어 도로명이 같은 후보를 먼저 고른 뒤 복호화해 비교한다.
 */
export async function findDuplicateReservations(
  input: { customerId: number | null; phone: string | null; roadAddress: string; detailAddress: string | null },
  now = new Date(),
) {
  if (isQuoteDemoMode()) return [];
  const days = await getSettingNumber(SETTING_KEYS.DUPLICATE_CHECK_DAYS);
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const hash = input.phone ? phoneHash(input.phone) : null;
  const rows = await getDb()
    .select({
      orderNo: serviceOrder.orderNo,
      status: serviceOrder.status,
      customerId: serviceOrder.customerId,
      promisedAt: serviceOrder.promisedAt,
      phoneHash: customer.phone1Hash,
      roadAddress: customerAddress.roadAddress,
      detailAddress: customerAddress.detailAddress,
    })
    .from(serviceOrder)
    .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
    .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
    .where(
      and(
        inArray(serviceOrder.status, [...ACTIVE_ORDER_STATUSES]),
        gte(serviceOrder.createdAt, since),
        isNull(serviceOrder.deletedAt),
        or(
          eq(customerAddress.roadAddress, input.roadAddress),
          hash ? eq(customer.phone1Hash, hash) : undefined,
          input.customerId ? eq(serviceOrder.customerId, input.customerId) : undefined,
        ),
      ),
    )
    .orderBy(desc(serviceOrder.createdAt))
    .limit(200);
  const key = addressKey(input.roadAddress, input.detailAddress);
  const dup = findDuplicateOrders(
    rows.map((r) => ({ ...r, addressKey: addressKey(r.roadAddress, decrypt(r.detailAddress)) })),
    { phoneHash: hash, addressKey: key },
  );
  const mine = input.customerId ? rows.filter((r) => r.customerId === input.customerId) : [];
  return [...new Map([...dup, ...mine].map((r) => [r.orderNo, { orderNo: r.orderNo, promisedAt: r.promisedAt }])).values()];
}

/* ---------- F-CUS-RSV-05 예약 확정 ---------- */

export type ReservationResult =
  | { ok: true; orderNo: string; needsPayment: boolean; totalAmount: number; demo?: boolean }
  | { ok: false; reason: 'SLOT_FULL' | 'DUPLICATE'; duplicates?: string[] };

/**
 * C-RSV-030 예약 확정: 주소 저장 → 주문(RECEIVED, 미결제) + 항목 + 상태 이력 → 슬롯 차감 → 견적 CONVERTED.
 * 선결제는 다음 화면(C-PAY-010)에서 결제 후 접수 알림, 현장 결제는 바로 접수 알림을 보낸다.
 */
export async function createReservation(
  c: CurrentCustomer,
  input: ReservationInput,
  demoRaw: string | null,
  now = new Date(),
): Promise<ReservationResult> {
  const q = await loadReservableQuote(input.quoteNo, demoRaw, now);
  if (!q) throw new UserError('견적을 찾을 수 없습니다. 다시 견적을 받아 주세요.');
  if (q.blocked) throw new UserError(q.blocked);
  // 견적을 받은 주소와 같은 관할 거점이어야 같은 가격·슬롯으로 예약할 수 있다
  const area = await findServiceArea(input.address.legalDongCode);
  if (!area.serviceable || area.branchId !== q.branchId)
    throw new UserError('견적을 받은 지역과 다른 주소입니다. 이 주소로 다시 견적을 받아 주세요.');
  const pricing = await priceForVisit(q.snapshot, input.slotDate, input.slotHour);
  if (c.demo || isQuoteDemoMode()) return { ok: true, orderNo: DEMO_ORDER_NO, needsPayment: input.payMethod === 'PREPAY', totalAmount: pricing.totalAmount, demo: true };

  if (!input.duplicateConfirmed) {
    const dup = await findDuplicateReservations(
      { customerId: c.id, phone: null, roadAddress: input.address.roadAddress, detailAddress: input.detailAddress },
      now,
    );
    const all = dup.map((d) => d.orderNo);
    if (all.length) return { ok: false, reason: 'DUPLICATE', duplicates: all };
  }

  const sched = scheduleColumns(input.slotDate, input.slotHour, q.durationMin);
  const hours = slotHoursFor(input.slotHour, q.durationMin);
  const db = getDb();
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await db.transaction(async (tx) => {
        const addressId = await upsertVisitAddress(
          tx,
          c.id,
          {
            zipcode: input.address.zipcode,
            roadAddress: input.address.roadAddress,
            jibunAddress: input.address.jibunAddress,
            legalDongCode: input.address.legalDongCode,
            detailAddress: input.detailAddress,
            housingType: input.housingType,
            hasElevator: input.hasElevator,
            parkingNote: input.parkingNote,
            branchId: q.branchId,
          },
          c.id,
        );
        const orderNo = await nextOrderNo(tx, now, attempt);
        assertOrderTransition(null, 'RECEIVED');
        const [o] = await tx
          .insert(serviceOrder)
          .values({
            orderNo,
            customerId: c.id,
            addressId,
            branchId: q.branchId,
            quoteId: q.id,
            channel: 'APP',
            orderType: 'NORMAL',
            status: 'RECEIVED',
            ...sched,
            visitType: pricing.timeRule?.ruleCode ?? 'IN_HOURS',
            requiredTechCount: 1,
            customerRequest: input.customerRequest,
            subtotalAmount: pricing.subtotalAmount,
            discountAmount: pricing.discountAmount,
            surchargeAmount: pricing.surchargeAmount,
            totalAmount: pricing.totalAmount,
            paymentStatus: 'UNPAID',
            isDuplicateChecked: true,
            createdBy: c.id,
            updatedBy: c.id,
          })
          .returning({ id: serviceOrder.id });
        await tx.insert(orderItem).values(
          pricing.items.map((i) => ({
            orderId: o!.id,
            itemType: i.itemType,
            productId: i.productId,
            optionId: i.optionId,
            surchargeRuleId: i.surchargeRuleId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            amount: i.amount,
          })),
        );
        await copyQuoteDevices(tx, q.id!, o!.id); // 단계 9 원클릭 재예약 기기 연결
        await tx.insert(orderStatusHistory).values(
          orderStatusHistoryRow({ orderId: o!.id, from: null, to: 'RECEIVED', actorType: 'CUSTOMER', actorId: c.id }),
        );
        // BR-021 잔여 차감 (조건부 UPDATE). 한 칸이라도 없으면 전체 취소
        if (!(await bookSlots(tx, { branchId: q.branchId, slotDate: input.slotDate, hours, units: 1 }))) {
          throw new SlotFullError();
        }
        assertQuoteTransition('ISSUED', 'CONVERTED');
        const converted = await tx
          .update(quote)
          .set({ status: 'CONVERTED', customerId: c.id, addressId, updatedAt: now, updatedBy: c.id })
          .where(and(eq(quote.id, q.id!), eq(quote.status, 'ISSUED')))
          .returning({ id: quote.id });
        if (converted.length === 0) throw new UserError('이미 예약한 견적입니다. 예약 내역에서 확인해 주세요.');
        return { orderId: o!.id, orderNo };
      });
      if (input.payMethod === 'ONSITE') await notifyOrder('ORDER_CONFIRMED', out.orderId);
      return { ok: true, orderNo: out.orderNo, needsPayment: input.payMethod === 'PREPAY', totalAmount: pricing.totalAmount };
    } catch (e) {
      if (e instanceof SlotFullError) return { ok: false, reason: 'SLOT_FULL' };
      if (isUniqueViolation(e) && attempt < 4) continue;
      throw e;
    }
  }
}

class SlotFullError extends Error {}

/* ---------- 고객 조회 (C-ORD-010·020, C-RSV-040, C-PAY-010) ---------- */

export async function listCustomerOrders(customerId: number) {
  return getDb()
    .select({
      id: serviceOrder.id,
      orderNo: serviceOrder.orderNo,
      status: serviceOrder.status,
      promisedAt: serviceOrder.promisedAt,
      totalAmount: serviceOrder.totalAmount,
      paymentStatus: serviceOrder.paymentStatus,
      roadAddress: customerAddress.roadAddress,
    })
    .from(serviceOrder)
    .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
    .where(and(eq(serviceOrder.customerId, customerId), isNull(serviceOrder.deletedAt)))
    .orderBy(desc(serviceOrder.promisedAt), desc(serviceOrder.id))
    .limit(100);
}

/** 본인 주문 1건 (다른 고객 주문은 null) */
export async function getCustomerOrder(customerId: number, orderNo: string) {
  const db = getDb();
  const [row] = await db
    .select({ order: serviceOrder, address: customerAddress, branchPhone: branch.phone, branchName: branch.name })
    .from(serviceOrder)
    .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
    .innerJoin(branch, eq(branch.id, serviceOrder.branchId))
    .where(and(eq(serviceOrder.orderNo, orderNo), eq(serviceOrder.customerId, customerId), isNull(serviceOrder.deletedAt)));
  if (!row) return null;
  const [items, history, requests, payments, techs] = await Promise.all([
    db.select().from(orderItem).where(eq(orderItem.orderId, row.order.id)),
    db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, row.order.id)).orderBy(orderStatusHistory.createdAt),
    db.select().from(orderChangeRequest).where(eq(orderChangeRequest.orderId, row.order.id)).orderBy(desc(orderChangeRequest.createdAt)),
    db.select().from(payment).where(eq(payment.orderId, row.order.id)).orderBy(desc(payment.createdAt)),
    // 배정 기사(주기사) 공개 정보: 고객 표시 이름·소개만 (연락처·위치 좌표는 보여 주지 않음, BR-115)
    db
      .select({ name: technician.name, displayName: technician.displayName, intro: technician.intro })
      .from(assignment)
      .innerJoin(technician, eq(technician.id, assignment.technicianId))
      .where(and(eq(assignment.orderId, row.order.id), eq(assignment.role, 'MAIN'), inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES]))),
  ]);
  const names = await itemNames(row.order.quoteId);
  const t = techs[0];
  return {
    ...row.order,
    roadAddress: row.address.roadAddress,
    detailAddress: decrypt(row.address.detailAddress),
    branchPhone: row.branchPhone,
    branchName: row.branchName,
    items: items.map((i) => ({ ...i, name: names(i) })),
    history,
    requests,
    payments,
    tech: t ? { name: t.displayName || t.name, intro: t.intro } : null,
  };
}

/** 주문 항목 표시명: 견적 스냅샷의 이름(BR-014). 없으면 항목 유형 */
export async function itemNames(quoteId: number | null) {
  const snap = quoteId
    ? ((await getDb().select({ s: quote.priceSnapshotJson }).from(quote).where(eq(quote.id, quoteId)))[0]?.s as QuoteSnapshot | undefined)
    : undefined;
  const catalog = await loadQuoteCatalog();
  return (i: { itemType: string; productId: number | null; optionId: number | null; surchargeRuleId: number | null }) =>
    snap?.items.find(
      (s) => s.itemType === i.itemType && s.productId === i.productId && s.optionId === i.optionId && s.surchargeRuleId === i.surchargeRuleId,
    )?.name ??
    (i.surchargeRuleId ? catalog.surchargeRules.find((r) => r.id === i.surchargeRuleId)?.name : undefined) ??
    (i.productId ? catalog.products.find((p) => p.id === i.productId)?.name : undefined) ??
    (i.optionId ? catalog.options.find((p) => p.id === i.optionId)?.name : undefined) ??
    // 단계 9 쿠폰 할인 행(상품·옵션·할증 없는 DISCOUNT)
    (i.itemType === 'DISCOUNT' && !i.productId && !i.optionId && !i.surchargeRuleId ? '쿠폰 할인' : undefined) ??
    i.itemType;
}

/** 홈 진행 중 예약 카드 (가장 가까운 방문 1건) */
export async function nextActiveOrder(customerId: number) {
  const [row] = await getDb()
    .select({ orderNo: serviceOrder.orderNo, status: serviceOrder.status, promisedAt: serviceOrder.promisedAt })
    .from(serviceOrder)
    .where(and(eq(serviceOrder.customerId, customerId), inArray(serviceOrder.status, [...ACTIVE_ORDER_STATUSES]), isNull(serviceOrder.deletedAt)))
    .orderBy(serviceOrder.promisedAt)
    .limit(1);
  return row ?? null;
}

/* ---------- F-CUS-PAY-01 결제 ---------- */

/** 결제 1회 시도 번호 = 포트원 결제 ID (P + KST 연월일시분초 + 임의 4자리) */
export function newPaymentNo(now = new Date()): string {
  const k = new Date(now.getTime() + 9 * 3600_000).toISOString().replace(/[-:T]/g, '').slice(2, 14);
  return `P${k}${Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0')}`;
}

/** 결제창에서 돌아온 결제 ID → 결제 번호 */
export function paymentNoOf(paymentId: string): string | null {
  const raw = paymentId.startsWith(MOCK_PAYMENT_PREFIX) ? paymentId.slice(MOCK_PAYMENT_PREFIX.length).replace(/-(OK|FAIL)$/, '') : paymentId;
  return /^P\d{12}[0-9A-Z]{4}$/.test(raw) ? raw : null;
}

/**
 * 결제 확인: PG 서버에 결제 ID로 다시 조회해 금액이 주문 금액과 같을 때만 승인(위변조 방지).
 * 승인이면 payment(APPROVED) + 주문 결제 상태 PREPAID + 접수 알림, 실패면 payment(FAILED)만 남긴다.
 */
export async function confirmPayment(customerId: number, orderNo: string, paymentId: string) {
  const db = getDb();
  const paymentNo = paymentNoOf(paymentId);
  if (!paymentNo) throw new UserError('결제 정보가 올바르지 않습니다.');
  const [o] = await db
    .select()
    .from(serviceOrder)
    .where(and(eq(serviceOrder.orderNo, orderNo), eq(serviceOrder.customerId, customerId)));
  if (!o) throw new UserError('예약을 찾을 수 없습니다.');
  const [done] = await db.select().from(payment).where(eq(payment.paymentNo, paymentNo));
  if (done) return { ok: done.status === 'APPROVED', failReason: done.failReason };
  // 작업이 시작된 뒤 금액은 작업 후 결제(C-PAY-020, confirmPostPayment)
  if (o.paymentStatus !== 'UNPAID' || !['QUOTED', 'RECEIVED', 'ASSIGN_WAIT', 'ASSIGNED'].includes(o.status)) throw new UserError('결제할 수 없는 예약입니다.');
  const gw = createPaymentGateway();
  const r = await gw.verify(paymentId, o.totalAmount);
  await db.transaction(async (tx) => {
    await tx.insert(payment).values({
      paymentNo,
      orderId: o.id,
      customerId,
      paymentStage: 'PREPAY',
      method: r.method ?? 'CARD',
      amount: r.ok ? r.amount : o.totalAmount,
      status: r.ok ? 'APPROVED' : 'FAILED',
      pgProvider: gw.provider,
      pgTid: r.pgTid,
      approvedAt: r.approvedAt,
      failReason: r.failReason?.slice(0, 300) ?? null,
      receiptUrl: r.receiptUrl,
      createdBy: customerId,
      updatedBy: customerId,
    });
    if (r.ok) {
      await tx
        .update(serviceOrder)
        .set({ paymentStatus: 'PREPAID', paidAmount: r.amount, updatedAt: new Date(), updatedBy: customerId })
        .where(and(eq(serviceOrder.id, o.id), eq(serviceOrder.paymentStatus, 'UNPAID')));
    }
  });
  if (r.ok) await notifyOrder('ORDER_CONFIRMED', o.id);
  return { ok: r.ok, failReason: r.failReason };
}

/** 선결제를 현장 결제로 바꾼다 (결제창에서 결제하지 않고 나가는 경우) — 접수 알림을 보낸다 */
export async function switchToOnsite(customerId: number, orderNo: string) {
  const [o] = await getDb()
    .select({ id: serviceOrder.id, paymentStatus: serviceOrder.paymentStatus })
    .from(serviceOrder)
    .where(and(eq(serviceOrder.orderNo, orderNo), eq(serviceOrder.customerId, customerId)));
  if (!o || o.paymentStatus !== 'UNPAID') return;
  await notifyOrder('ORDER_CONFIRMED', o.id);
}

/* ---------- 환불 (BR-030) ---------- */

/** 승인된 결제를 PG에서 취소하고 refund 행을 남긴다. 실패하면 오류(주문 취소도 하지 않음) */
export async function refundPayments(
  o: Pick<OrderRow, 'id' | 'paidAmount'>,
  amount: number,
  fee: number,
  reasonCode: string,
  reasonDetail: string | null,
  actor: Actor,
) {
  if (amount <= 0) return [] as (typeof refund.$inferInsert)[];
  const db = getDb();
  const pays = await db
    .select()
    .from(payment)
    .where(and(eq(payment.orderId, o.id), eq(payment.status, 'APPROVED')))
    .orderBy(desc(payment.createdAt));
  const pay = pays[0];
  if (!pay) return [];
  const gw = createPaymentGateway();
  const cancelId = pay.pgProvider === 'MOCK' ? (pay.pgTid ?? pay.paymentNo) : pay.paymentNo;
  const r = await gw.cancel(cancelId, amount, reasonDetail ?? reasonCode);
  if (!r.ok) throw new UserError(`환불 처리에 실패했습니다(${r.failReason ?? 'PG 오류'}). 잠시 후 다시 시도하거나 고객센터로 연락해 주세요.`);
  return [
    {
      paymentId: pay.id,
      amount,
      reasonCode,
      reasonDetail,
      cancelFee: fee,
      status: 'DONE',
      pgCancelTid: r.cancelTid,
      requestedBy: actor.type,
      approvedBy: actor.type === 'ADMIN' ? actor.id : null,
      refundedAt: new Date(),
      createdBy: actor.id,
      updatedBy: actor.id,
    },
  ];
}

/**
 * 주문 취소 공통 (고객 즉시 취소 F-CUS-ORD-03 · 관리자 취소 F-ADM-ORD-04):
 * PG 환불 → 트랜잭션(상태 CANCELED + 이력, 환불 행, 결제 상태, 슬롯 반환, 취소 요청 기록) → 취소 알림.
 */
export async function cancelOrder(
  o: OrderRow,
  input: { reasonCode: string; memo: string | null; refundAmount: number; fee: number; changeRequest: boolean },
  actor: Actor,
) {
  assertOrderTransition(o.status, 'CANCELED');
  const refunds = await refundPayments(o, input.refundAmount, input.fee, actor.type === 'CUSTOMER' ? 'CUSTOMER_CANCEL' : 'SERVICE_FAIL', input.memo, actor);
  const refunded = refunds.reduce((s, r) => s + r.amount, 0);
  await getDb().transaction(async (tx) => {
    await transitionOrder(tx, o, 'CANCELED', actor, {
      reasonCode: input.reasonCode,
      memo: input.memo,
      set: {
        cancelReason: input.reasonCode,
        canceledAt: new Date(),
        paymentStatus: paymentStatusAfterRefund(o.paymentStatus, o.paidAmount, refunded),
      },
    });
    if (refunds.length) await tx.insert(refund).values(refunds);
    await restoreCouponOnCancel(tx, o.id); // 단계 9 F-CUS-PAY-04 쓴 쿠폰 돌려주기
    const target = orderSlotTarget(o);
    if (target) await releaseSlots(tx, target);
    if (input.changeRequest) {
      await tx.insert(orderChangeRequest).values({
        orderId: o.id,
        requestType: 'CANCEL',
        reason: input.memo,
        status: 'APPROVED',
        handledAt: new Date(),
        createdBy: actor.id,
        updatedBy: actor.id,
      });
    }
  });
  await notifyOrder('ORDER_CANCELED', o.id);
  return { refunded };
}

/** C-ORD-030 취소 미리보기: 수수료·환불 예정 금액 (BR-030) */
export async function cancelPreview(o: Pick<OrderRow, 'promisedAt' | 'paidAmount'>, now = new Date()) {
  const [feeHours, feeAmount] = await Promise.all([
    getSettingNumber(SETTING_KEYS.CANCEL_FEE_HOURS),
    getSettingNumber(SETTING_KEYS.CANCEL_FEE_AMOUNT),
  ]);
  return { feeHours, ...cancelPolicy({ promisedAt: o.promisedAt ?? now, now, paidAmount: o.paidAmount, feeHours, feeAmount }) };
}

/** F-CUS-ORD-03 고객 즉시 취소 (접수·배정완료 상태만) */
export async function cancelByCustomer(customerId: number, orderNo: string, reason: string | null) {
  const [o] = await getDb()
    .select()
    .from(serviceOrder)
    .where(and(eq(serviceOrder.orderNo, orderNo), eq(serviceOrder.customerId, customerId)));
  if (!o) throw new UserError('예약을 찾을 수 없습니다.');
  if (!canCustomerCancel(o.status)) throw new UserError('기사님이 출발한 뒤에는 앱에서 취소할 수 없습니다. 고객센터로 연락해 주세요.');
  const p = await cancelPreview(o);
  return cancelOrder(o, { reasonCode: 'CUSTOMER_REQUEST', memo: reason, refundAmount: p.refundAmount, fee: p.fee, changeRequest: true }, { type: 'CUSTOMER', id: customerId });
}

/** F-CUS-ORD-03 일정 변경 요청 → 상담원이 A-ORD-030에서 승인하면 슬롯을 옮긴다 */
export async function requestReschedule(customerId: number, orderNo: string, date: string, hour: number, reason: string | null) {
  const db = getDb();
  const [o] = await db
    .select()
    .from(serviceOrder)
    .where(and(eq(serviceOrder.orderNo, orderNo), eq(serviceOrder.customerId, customerId)));
  if (!o) throw new UserError('예약을 찾을 수 없습니다.');
  if (!canCustomerCancel(o.status)) throw new UserError('기사님이 출발한 뒤에는 앱에서 일정을 바꿀 수 없습니다. 고객센터로 연락해 주세요.');
  const [open] = await db
    .select({ id: orderChangeRequest.id })
    .from(orderChangeRequest)
    .where(and(eq(orderChangeRequest.orderId, o.id), eq(orderChangeRequest.status, 'REQUESTED')));
  if (open) throw new UserError('이미 처리 중인 변경 요청이 있습니다.');
  await db.insert(orderChangeRequest).values({
    orderId: o.id,
    requestType: 'RESCHEDULE',
    requestedDate: date,
    requestedTime: `${hourToTime(hour)}:00`,
    reason,
    status: 'REQUESTED',
    createdBy: customerId,
    updatedBy: customerId,
  });
}

/* ---------- C-NTF-010 알림함 ---------- */

export async function listCustomerNotifications(customerId: number) {
  return getDb()
    .select({
      id: notificationLog.id,
      title: notificationTemplate.title,
      templateCode: notificationTemplate.templateCode,
      channel: notificationLog.channel,
      status: notificationLog.status,
      sentAt: notificationLog.sentAt,
      createdAt: notificationLog.createdAt,
      orderNo: serviceOrder.orderNo,
    })
    .from(notificationLog)
    .leftJoin(notificationTemplate, eq(notificationTemplate.id, notificationLog.templateId))
    .leftJoin(serviceOrder, and(eq(notificationLog.relatedType, 'ORDER'), eq(serviceOrder.id, notificationLog.relatedId)))
    .where(and(eq(notificationLog.receiverType, 'CUSTOMER'), eq(notificationLog.receiverId, customerId)))
    .orderBy(desc(notificationLog.createdAt))
    .limit(100);
}

/* ---------- F-SYS-03 방문 전날 알림 (매일 18:00) ---------- */

/** 내일(한국 날짜) 방문 예정인 진행 중 주문에 방문 안내를 보낸다. 같은 주문에 이미 보낸 경우는 건너뛴다 */
export async function remindVisits(now = new Date()): Promise<number> {
  const db = getDb();
  const tomorrow = slotDates(kstToday(now), 1)[0]!;
  const [t] = await db.select({ id: notificationTemplate.id }).from(notificationTemplate).where(eq(notificationTemplate.templateCode, 'VISIT_REMINDER'));
  const orders = await db
    .select({ id: serviceOrder.id })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.requestedDate, tomorrow),
        inArray(serviceOrder.status, ['RECEIVED', 'ASSIGN_WAIT', 'ASSIGNED']),
        isNull(serviceOrder.deletedAt),
        t
          ? sql`not exists (select 1 from notification_log l where l.related_type = 'ORDER' and l.related_id = ${serviceOrder.id} and l.template_id = ${t.id})`
          : undefined,
      ),
    );
  for (const o of orders) await notifyOrder('VISIT_REMINDER', o.id);
  return orders.length;
}
