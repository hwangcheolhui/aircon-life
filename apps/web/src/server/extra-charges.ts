import 'server-only';
/**
 * 현장 추가요금 (단계 5-2) · F-TEC-WRK-05 등록·철회·현장 서명 · F-CUS-ORD-04 고객 앱 동의/거절 · F-ADM-PRC-04 기타 추가요금 승인/반려.
 * BR-040 동의 없는 추가요금은 청구하지 않는다(완료 금액에는 AGREED 만). BR-042 ETC 는 관리자 승인 후에만 고객에게 동의를 요청한다.
 * DEVICE_ADD(현장 기기 추가, F-TEC-WRK-04)는 같은 주문의 상품 항목 단가(견적 스냅샷, BR-014) × 대수이고, 동의되면 새 주문 항목을 만들어
 * 사진·결과를 입력할 기기가 늘어난다. 금액은 주문 항목 합계가 아니라 추가요금(extra_amount)으로 청구한다.
 */
import { extraCharge, orderItem, serviceOrder, surchargeRule, technician, workOrder } from '@aircon/db';
import {
  type BranchFilter,
  agreedExtraTotal,
  approvalStatusFor,
  canCustomerRespond,
  canWithdrawExtra,
  checkExtraChargeInput,
  extraChargeState,
  pendingExtraCount,
  ruleChargeAmount,
} from '@aircon/domain';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { UserError, ValidationFailed } from './action-result';
import { branchCond } from './admin-orders';
import { saveAttachment } from './attachments';
import { getDb } from './db';
import { notifyOrder, notifyStaffWith } from './notify';
import { itemNames } from './orders';
import { PHOTO_MAX_BYTES, fileUrl, mainOnly, mine, unitsOf, workOf } from './work';

type ChargeRow = typeof extraCharge.$inferSelect;
const EDITABLE_WORK = ['ARRIVED', 'IN_PROGRESS'];

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

function view(c: ChargeRow) {
  return {
    id: c.id,
    chargeType: c.chargeType,
    title: c.title,
    quantity: c.quantity,
    amount: c.amount,
    reason: c.reason,
    state: extraChargeState(c),
    agreedMethod: c.agreedMethod,
    agreedAt: c.agreedAt?.toISOString() ?? null,
    rejectReason: c.rejectReason,
    evidenceUrl: c.evidenceFileId ? fileUrl(c.evidenceFileId) : null,
    createdAt: c.createdAt.toISOString(),
  };
}
export type ExtraChargeView = ReturnType<typeof view>;

export async function chargesOfWork(workOrderId: number): Promise<ChargeRow[]> {
  return getDb().select().from(extraCharge).where(eq(extraCharge.workOrderId, workOrderId)).orderBy(asc(extraCharge.id));
}

/** 완료 검증·금액에 쓰는 요약: 동의된 합계(BR-040), 응답 전 건수(승인 대기 포함) */
export async function extraSummary(workOrderId: number | null) {
  const rows = workOrderId ? await chargesOfWork(workOrderId) : [];
  return { agreed: agreedExtraTotal(rows), pending: pendingExtraCount(rows), rows };
}

function checkImage(f: File | null, label: string) {
  if (f && (!f.type.startsWith('image/') || f.size > PHOTO_MAX_BYTES)) throw new UserError(`${label}은 4MB 이하 이미지만 올릴 수 있습니다.`);
}

/* ---------- T-WRK-040 기사 화면 ---------- */

export async function getExtraScreen(techId: number, orderNo: string) {
  const m = await mine(techId, orderNo);
  const db = getDb();
  const w = await workOf(db, m.o.id);
  const [rules, items, names, { units }] = await Promise.all([
    db.select().from(surchargeRule).where(and(eq(surchargeRule.applyType, 'ON_SITE'), eq(surchargeRule.isActive, true))).orderBy(asc(surchargeRule.id)),
    db.select().from(orderItem).where(and(eq(orderItem.orderId, m.o.id), eq(orderItem.itemType, 'PRODUCT'))).orderBy(asc(orderItem.id)),
    itemNames(m.o.quoteId),
    unitsOf(m.o),
  ]);
  const rows = w ? await chargesOfWork(w.id) : [];
  return {
    orderNo: m.o.orderNo,
    role: m.a.role,
    workStatus: w?.status ?? null,
    editable: Boolean(w && EDITABLE_WORK.includes(w.status) && m.a.role === 'MAIN'),
    laborAmount: m.o.totalAmount,
    unitCount: units.length,
    agreed: agreedExtraTotal(rows),
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      amount: ruleChargeAmount(r, units.length, m.o.totalAmount),
      customerNotice: r.customerNotice,
    })),
    products: items.map((i) => ({ id: i.id, name: names(i), unitPrice: i.unitPrice })),
    charges: rows.map(view),
  };
}

/** F-TEC-WRK-05 추가요금 등록. 규칙·자재·기기 추가는 바로 고객 동의 요청, 기타는 관리자 승인 요청(BR-042) */
export async function addExtraCharge(
  techId: number,
  v: {
    orderNo: string;
    chargeType: 'RULE' | 'MATERIAL' | 'ETC' | 'DEVICE_ADD';
    surchargeRuleId: number | null;
    baseOrderItemId: number | null;
    quantity: number | null;
    title: string | null;
    amount: number | null;
    reason: string;
  },
  evidence: File | null,
  agreeUrl: (orderNo: string) => string,
) {
  const m = await mainOnly(techId, v.orderNo);
  const db = getDb();
  const w = await workOf(db, m.o.id);
  if (!w || !EDITABLE_WORK.includes(w.status)) throw new UserError('도착 후 작업 중에만 추가요금을 등록할 수 있습니다.');
  checkImage(evidence, '증빙 사진');
  let title = v.title ?? '';
  let amount = v.amount ?? 0;
  let quantity = 1;
  let ruleId: number | null = null;
  let baseItemId: number | null = null;
  if (v.chargeType === 'RULE' && v.surchargeRuleId) {
    const [r] = await db
      .select()
      .from(surchargeRule)
      .where(and(eq(surchargeRule.id, v.surchargeRuleId), eq(surchargeRule.applyType, 'ON_SITE'), eq(surchargeRule.isActive, true)));
    if (!r) throw new UserError('사용할 수 없는 추가요금 규칙입니다.');
    const { units } = await unitsOf(m.o);
    ruleId = r.id;
    title = r.name;
    amount = ruleChargeAmount(r, units.length, m.o.totalAmount);
  }
  if (v.chargeType === 'DEVICE_ADD') {
    quantity = v.quantity ?? 0;
    const [base] = v.baseOrderItemId
      ? await db
          .select()
          .from(orderItem)
          .where(and(eq(orderItem.id, v.baseOrderItemId), eq(orderItem.orderId, m.o.id), eq(orderItem.itemType, 'PRODUCT')))
      : [];
    if (!base) throw new ValidationFailed({ baseOrderItemId: '추가할 기기 종류를 골라 주세요.' });
    baseItemId = base.id;
    title = `${(await itemNames(m.o.quoteId))(base)} ${quantity}대 추가`;
    amount = base.unitPrice * Math.max(quantity, 0);
  }
  const errors = checkExtraChargeInput({
    chargeType: v.chargeType,
    title,
    amount,
    reason: v.reason,
    hasEvidence: Boolean(evidence && evidence.size > 0),
    hasRule: ruleId !== null,
    quantity,
  });
  if (Object.keys(errors).length) throw new ValidationFailed(errors);
  const approvalStatus = approvalStatusFor(v.chargeType);
  const created = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(extraCharge)
      .values({
        workOrderId: w.id,
        surchargeRuleId: ruleId,
        chargeType: v.chargeType,
        title: title.slice(0, 100),
        quantity,
        baseOrderItemId: baseItemId,
        amount,
        reason: v.reason,
        approvalStatus,
        createdBy: techId,
        updatedBy: techId,
      })
      .returning();
    if (evidence && evidence.size > 0) {
      const f = await saveAttachment(evidence, 'EXTRA_CHARGE', c!.id, { type: 'TECHNICIAN', id: techId }, tx);
      await tx.update(extraCharge).set({ evidenceFileId: f.id }).where(eq(extraCharge.id, c!.id));
    }
    return c!;
  });
  const vars = { 접수번호: m.o.orderNo, 추가요금: `${created.title} ${won(created.amount)}` };
  if (approvalStatus === 'REQUESTED') await notifyStaffWith('EXTRA_APPROVAL_REQUESTED', { type: 'ADMIN', id: null }, { type: 'ORDER', id: m.o.id }, vars, '/admin/prc/extra-charges');
  else await notifyOrder('EXTRA_CHARGE_REQUEST', m.o.id, { 추가요금: vars.추가요금, 동의링크: agreeUrl(m.o.orderNo) });
  return { id: created.id, approvalStatus };
}

/** 응답 전 추가요금 철회 (행은 남기고 deleted_at) */
export async function withdrawExtraCharge(techId: number, orderNo: string, chargeId: number) {
  const m = await mainOnly(techId, orderNo);
  const db = getDb();
  const w = await workOf(db, m.o.id);
  const [c] = w ? await db.select().from(extraCharge).where(and(eq(extraCharge.id, chargeId), eq(extraCharge.workOrderId, w.id))) : [];
  if (!c) throw new UserError('추가요금을 찾을 수 없습니다.');
  if (!canWithdrawExtra(c)) throw new UserError('고객이 이미 응답한 추가요금은 철회할 수 없습니다.');
  await db
    .update(extraCharge)
    .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: techId })
    .where(and(eq(extraCharge.id, c.id), isNull(extraCharge.deletedAt), isNull(extraCharge.agreedAt)));
}

/** 응답 공통: 동의면 기기 추가 항목을 만들고, 기사에게 결과 알림 */
async function respond(c: ChargeRow, agree: boolean, method: 'APP_CONFIRM' | 'SIGNATURE', actorId: number | null, signature: File | null, techId: number | null) {
  const db = getDb();
  const [w] = await db.select().from(workOrder).where(eq(workOrder.id, c.workOrderId));
  const [o] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, w!.orderId));
  if (agree && !EDITABLE_WORK.includes(w!.status)) throw new UserError('작업이 끝나 추가요금에 동의할 수 없습니다.');
  const now = new Date();
  await db.transaction(async (tx) => {
    const sig = signature ? await saveAttachment(signature, 'EXTRA_CHARGE', c.id, { type: 'TECHNICIAN', id: techId! }, tx) : null;
    let newItemId: number | null = null;
    if (agree && c.chargeType === 'DEVICE_ADD' && c.baseOrderItemId) {
      const [base] = await tx.select().from(orderItem).where(eq(orderItem.id, c.baseOrderItemId));
      const [it] = await tx
        .insert(orderItem)
        .values({
          orderId: o!.id,
          itemType: 'PRODUCT',
          productId: base!.productId,
          quantity: c.quantity,
          unitPrice: base!.unitPrice,
          amount: c.amount,
        })
        .returning({ id: orderItem.id });
      newItemId = it!.id;
    }
    const rows = await tx
      .update(extraCharge)
      .set({
        customerAgreed: agree,
        agreedMethod: agree ? method : null,
        agreedAt: now,
        signatureFileId: sig?.id ?? null,
        orderItemId: newItemId,
        updatedAt: now,
        updatedBy: actorId,
      })
      .where(and(eq(extraCharge.id, c.id), isNull(extraCharge.agreedAt), isNull(extraCharge.deletedAt)))
      .returning({ id: extraCharge.id });
    if (!rows.length) throw new UserError('이미 처리된 추가요금입니다. 새로고침 후 확인해 주세요.');
  });
  await notifyStaffWith(
    'EXTRA_CHARGE_RESULT',
    { type: 'TECHNICIAN', id: w!.mainTechnicianId },
    { type: 'ORDER', id: o!.id },
    { 접수번호: o!.orderNo, 추가요금: c.title, 결과: agree ? '고객 동의' : '고객 거절(청구 안 함)' },
    `/tech/jobs/${o!.orderNo}/work/extra`,
  );
}

/** 현장 서명으로 동의 받기 (앱 미사용 고객, BR-040) */
export async function signExtraCharge(techId: number, orderNo: string, chargeId: number, signature: File | null) {
  const m = await mainOnly(techId, orderNo);
  if (!signature || signature.size === 0) throw new UserError('고객 서명을 받아 주세요.');
  checkImage(signature, '서명');
  const db = getDb();
  const w = await workOf(db, m.o.id);
  const [c] = w ? await db.select().from(extraCharge).where(and(eq(extraCharge.id, chargeId), eq(extraCharge.workOrderId, w.id))) : [];
  if (!c) throw new UserError('추가요금을 찾을 수 없습니다.');
  if (!canCustomerRespond(c)) throw new UserError(c.approvalStatus === 'REQUESTED' ? '관리자 승인 후에 동의를 받을 수 있습니다.' : '이미 처리된 추가요금입니다.');
  await respond(c, true, 'SIGNATURE', techId, signature, techId);
}

/* ---------- C-ORD-040 고객 동의 ---------- */

async function customerOrder(customerId: number, orderNo: string) {
  const [o] = await getDb()
    .select()
    .from(serviceOrder)
    .where(and(eq(serviceOrder.orderNo, orderNo), eq(serviceOrder.customerId, customerId), isNull(serviceOrder.deletedAt)));
  return o ?? null;
}

/** 고객에게 보이는 추가요금: 승인 대기·반려·철회는 숨긴다(BR-042) */
export async function customerExtraCharges(customerId: number, orderNo: string) {
  const o = await customerOrder(customerId, orderNo);
  if (!o) return null;
  const w = await workOf(getDb(), o.id);
  const rows = w ? await chargesOfWork(w.id) : [];
  const visible = rows.filter((c) => ['WAIT_CUSTOMER', 'AGREED', 'DECLINED'].includes(extraChargeState(c)));
  return {
    orderId: o.id,
    orderNo: o.orderNo,
    orderStatus: o.status,
    canRespond: Boolean(w && EDITABLE_WORK.includes(w.status)),
    agreed: agreedExtraTotal(rows),
    charges: visible.map(view),
    /** 고객 화면 금액 표에서 따로 보여 줄 기기 추가 항목(중복 표시 방지) */
    addedItemIds: rows.filter((c) => c.orderItemId).map((c) => c.orderItemId!),
  };
}

export async function respondByCustomer(customerId: number, orderNo: string, chargeId: number, agree: boolean) {
  const o = await customerOrder(customerId, orderNo);
  if (!o) throw new UserError('예약을 찾을 수 없습니다.');
  const db = getDb();
  const w = await workOf(db, o.id);
  const [c] = w ? await db.select().from(extraCharge).where(and(eq(extraCharge.id, chargeId), eq(extraCharge.workOrderId, w.id))) : [];
  if (!c || !canCustomerRespond(c)) throw new UserError('이미 처리되었거나 동의할 수 없는 추가요금입니다.');
  await respond(c, agree, 'APP_CONFIRM', null, null, null);
}

/** 사진 열람 권한: 추가요금 증빙·서명 */
export async function extraChargeOrder(chargeId: number) {
  const [r] = await getDb()
    .select({ orderNo: serviceOrder.orderNo, customerId: serviceOrder.customerId, branchId: serviceOrder.branchId, c: extraCharge })
    .from(extraCharge)
    .innerJoin(workOrder, eq(workOrder.id, extraCharge.workOrderId))
    .innerJoin(serviceOrder, eq(serviceOrder.id, workOrder.orderId))
    .where(eq(extraCharge.id, chargeId));
  return r ?? null;
}

/* ---------- A-PRC-040 관리자 승인 ---------- */

export async function listExtraApprovals(filter: BranchFilter, tab: 'REQUESTED' | 'DONE') {
  const rows = await getDb()
    .select({ c: extraCharge, orderNo: serviceOrder.orderNo, branchId: serviceOrder.branchId, techId: workOrder.mainTechnicianId })
    .from(extraCharge)
    .innerJoin(workOrder, eq(workOrder.id, extraCharge.workOrderId))
    .innerJoin(serviceOrder, eq(serviceOrder.id, workOrder.orderId))
    .where(
      and(
        eq(extraCharge.chargeType, 'ETC'),
        tab === 'REQUESTED' ? eq(extraCharge.approvalStatus, 'REQUESTED') : inArray(extraCharge.approvalStatus, ['APPROVED', 'REJECTED']),
        tab === 'REQUESTED' ? isNull(extraCharge.deletedAt) : undefined,
        branchCond(filter),
      ),
    )
    .orderBy(asc(extraCharge.createdAt))
    .limit(200);
  const techIds = [...new Set(rows.map((r) => r.techId))];
  const techs = techIds.length
    ? await getDb().select({ id: technician.id, name: technician.name, displayName: technician.displayName }).from(technician).where(inArray(technician.id, techIds))
    : [];
  return rows.map((r) => {
    const t = techs.find((x) => x.id === r.techId);
    return { ...view(r.c), orderNo: r.orderNo, branchId: r.branchId, techName: t?.displayName || t?.name || '', approvalStatus: r.c.approvalStatus };
  });
}
export type ExtraApprovalRow = Awaited<ReturnType<typeof listExtraApprovals>>[number];

/** F-ADM-PRC-04 승인 → 고객 동의 요청, 반려 → 기사에게 알림(청구 안 함) */
export async function decideExtraCharge(
  v: { chargeId: number; decision: 'APPROVE' | 'REJECT'; reason: string | null },
  filter: BranchFilter,
  adminId: number,
  agreeUrl: (orderNo: string) => string,
) {
  const r = await extraChargeOrder(v.chargeId);
  if (!r || r.c.chargeType !== 'ETC') throw new UserError('추가요금을 찾을 수 없습니다.');
  if (filter.kind === 'NONE' || (filter.kind === 'BRANCH' && filter.branchId !== r.branchId)) throw new UserError('다른 거점의 추가요금은 처리할 수 없습니다.');
  if (r.c.deletedAt) throw new UserError('기사가 철회한 추가요금입니다.');
  const now = new Date();
  const rows = await getDb()
    .update(extraCharge)
    .set({
      approvalStatus: v.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      approvedBy: adminId,
      approvedAt: now,
      rejectReason: v.decision === 'REJECT' ? v.reason : null,
      updatedAt: now,
      updatedBy: adminId,
    })
    .where(and(eq(extraCharge.id, r.c.id), eq(extraCharge.approvalStatus, 'REQUESTED'), isNull(extraCharge.deletedAt)))
    .returning({ id: extraCharge.id });
  if (!rows.length) throw new UserError('이미 처리된 추가요금입니다.');
  const [w] = await getDb().select().from(workOrder).where(eq(workOrder.id, r.c.workOrderId));
  const label = `${r.c.title} ${won(r.c.amount)}`;
  if (v.decision === 'APPROVE') {
    await notifyOrder('EXTRA_CHARGE_REQUEST', w!.orderId, { 추가요금: label, 동의링크: agreeUrl(r.orderNo) });
  }
  await notifyStaffWith(
    'EXTRA_CHARGE_RESULT',
    { type: 'TECHNICIAN', id: w!.mainTechnicianId },
    { type: 'ORDER', id: w!.orderId },
    { 접수번호: r.orderNo, 추가요금: r.c.title, 결과: v.decision === 'APPROVE' ? '관리자 승인(고객 동의 요청함)' : `관리자 반려: ${v.reason ?? ''}` },
    `/tech/jobs/${r.orderNo}/work/extra`,
  );
}
