import 'server-only';
/**
 * 단계 6 결제·증빙 서버 서비스 (F-TEC-PAY-01~03, F-CUS-PAY-02·03, F-ADM-PAY-01~05, BR-081·082, 01 §3.1 WORK_DONE → COMPLETED).
 * - 결제·환불은 INSERT ONLY: 결제 확인이 끝난 최종 상태로 1행만 넣는다. 주문 paid_amount·payment_status 는 합계 캐시.
 * - 결제가 들어오면 applyPayment() 하나로 주문 금액 캐시를 바꾸고, 작업완료 + 전액이면 주문을 COMPLETED(SYSTEM)로 바꾸고
 *   작업 건을 정산 대상(is_settlement_target, BR-081)으로 표시한다. 미수(RECEIVABLE)는 결제가 끝날 때까지 정산 제외.
 * - BR-082 기사가 직접 받은 현금·계좌이체는 payment.collected_by_tech_id 와 work_order.received_amount 로 남겨 정산(단계 7)에서 상계한다.
 * - 증빙 번호(휴대폰·사업자번호)는 암호화해 저장하고 목록은 마스킹, 원문 열람은 감사 로그(BR-100).
 */
import {
  activityLog,
  customer,
  memo,
  payment,
  refund,
  serviceOrder,
  taxDocument,
  technician,
  workOrder,
} from '@aircon/db';
import {
  type BranchFilter,
  type FieldErrors,
  assertTaxDocTransition,
  checkCollect,
  checkReceivable,
  checkRefund,
  checkTaxDocInput,
  completionAfterPayment,
  isFieldCollected,
  kstDate,
  maskName,
  orderBalance,
  paymentStatusAfterPay,
  paymentStatusAfterRefund,
  refundableOf,
  settlementTargetOf,
  splitVat,
  taxDocTypesFor,
} from '@aircon/domain';
import { createPaymentGateway, createReceiptIssuer } from '@aircon/integrations';
import { type SQL, and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { UserError, ValidationFailed } from './action-result';
import { branchCond } from './admin-orders';
import { writeAudit } from './audit';
import { getDb } from './db';
import { notifyOrder } from './notify';
import { type Actor, type OrderRow, type Tx, newPaymentNo, paymentNoOf, transitionOrder } from './orders';
import { decrypt, encrypt } from './pii';
import { mainOnly } from './work';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const fail = (e: FieldErrors) => {
  if (e.form) throw new UserError(e.form);
  if (Object.keys(e).length) throw new ValidationFailed(e);
};

/** 결제 링크 (C-PAY-020) */
export const payUrl = (origin: string, orderNo: string) => `${origin}/orders/${orderNo}/pay`;

/* ---------- 공통: 결제 반영 ---------- */

/**
 * 승인된 결제 1건을 주문에 반영한다: paid_amount·payment_status(조건부 UPDATE로 동시 결제 방지),
 * 작업완료 + 전액이면 COMPLETED(01 §3.1, SYSTEM) + 정산 대상 표시(BR-081).
 * 반환: 주문이 완료되었는지
 */
export async function applyPayment(
  tx: Tx,
  o: Pick<OrderRow, 'id' | 'status' | 'totalAmount' | 'paidAmount'>,
  amount: number,
  actorId: number | null,
) {
  const paid = o.paidAmount + amount;
  const paymentStatus = paymentStatusAfterPay(o.totalAmount, paid);
  const rows = await tx
    .update(serviceOrder)
    .set({ paidAmount: paid, paymentStatus, updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(serviceOrder.id, o.id), eq(serviceOrder.paidAmount, o.paidAmount)))
    .returning({ id: serviceOrder.id });
  if (!rows.length)
    throw new UserError('다른 곳에서 먼저 결제가 처리되었습니다. 새로고침 후 다시 확인해 주세요.');
  return completeIfPaid(tx, {
    id: o.id,
    status: o.status,
    totalAmount: o.totalAmount,
    paidAmount: paid,
    paymentStatus,
  });
}

/** 01 §3.1 WORK_DONE → COMPLETED 자동 전환 + BR-081 정산 대상 */
export async function completeIfPaid(
  tx: Tx,
  o: { id: number; status: string; totalAmount: number; paidAmount: number; paymentStatus: string },
): Promise<boolean> {
  if (!completionAfterPayment(o)) return false;
  await transitionOrder(
    tx,
    o,
    'COMPLETED',
    { type: 'SYSTEM', id: null },
    { memo: '결제 완료', set: { paymentStatus: 'PAID' } },
  );
  await tx
    .update(workOrder)
    .set({
      isSettlementTarget: settlementTargetOf({ status: 'COMPLETED', paymentStatus: 'PAID' }),
      updatedAt: new Date(),
    })
    .where(eq(workOrder.orderId, o.id));
  return true;
}

async function orderByNo(orderNo: string) {
  const [o] = await getDb().select().from(serviceOrder).where(eq(serviceOrder.orderNo, orderNo));
  if (!o) throw new UserError('주문을 찾을 수 없습니다.');
  return o;
}

async function orderById(orderId: number, filter: BranchFilter) {
  const [o] = await getDb()
    .select()
    .from(serviceOrder)
    .where(and(eq(serviceOrder.id, orderId), branchCond(filter)));
  if (!o) throw new UserError('주문을 찾을 수 없습니다.');
  return o;
}

/** 주문의 결제 목록 + 결제별 환불·증빙 */
export async function paymentsOf(orderId: number) {
  const db = getDb();
  const pays = await db.select().from(payment).where(eq(payment.orderId, orderId)).orderBy(asc(payment.id));
  const ids = pays.map((p) => p.id);
  const [refunds, docs] = ids.length
    ? await Promise.all([
        db.select().from(refund).where(inArray(refund.paymentId, ids)),
        db.select().from(taxDocument).where(inArray(taxDocument.paymentId, ids)).orderBy(asc(taxDocument.id)),
      ])
    : [[], []];
  return pays.map((p) => ({
    id: p.id,
    paymentNo: p.paymentNo,
    stage: p.paymentStage,
    method: p.method,
    amount: p.amount,
    status: p.status,
    approvedAt: p.approvedAt,
    createdAt: p.createdAt,
    failReason: p.failReason,
    receiptUrl: p.receiptUrl,
    refunded: refunds
      .filter((r) => r.paymentId === p.id && r.status === 'DONE')
      .reduce((s, r) => s + r.amount, 0),
    /** 이 결제로 신청할 수 있는 증빙 (승인 + 현금·계좌이체만) */
    taxDocTypes: p.status === 'APPROVED' ? taxDocTypesFor(p.method) : [],
    taxDocs: docs
      .filter((d) => d.paymentId === p.id)
      .map((d) => ({
        id: d.id,
        docType: d.docType,
        issueStatus: d.issueStatus,
        issuedNo: d.issuedNo,
        failReason: d.failReason,
      })),
  }));
}
export type OrderPayment = Awaited<ReturnType<typeof paymentsOf>>[number];

/** 결제 화면 공통 요약: 작업비·현장 추가·청구·결제·잔액 */
export function amountSummary(o: OrderRow) {
  return {
    orderNo: o.orderNo,
    status: o.status,
    paymentStatus: o.paymentStatus,
    laborAmount: o.totalAmount - o.extraAmount,
    extraAmount: o.extraAmount,
    totalAmount: o.totalAmount,
    paidAmount: o.paidAmount,
    balance: orderBalance(o),
  };
}

/* ---------- T-PAY-010 기사 현장 결제 ---------- */

export async function getTechPayment(techId: number, orderNo: string) {
  const m = await mainOnly(techId, orderNo);
  const o = await orderByNo(m.o.orderNo);
  return { ...amountSummary(o), payments: await paymentsOf(o.id) };
}
export type TechPaymentState = Awaited<ReturnType<typeof getTechPayment>>;

/** F-TEC-PAY-01·02 카드단말·계좌이체·현금 수금 기록 → 전액이면 주문 완료 */
export async function collectInField(
  techId: number,
  v: { orderNo: string; method: string; amount: number; approvalNo: string | null },
) {
  const m = await mainOnly(techId, v.orderNo);
  const o = await orderByNo(m.o.orderNo);
  fail(checkCollect({ method: v.method, amount: v.amount, balance: orderBalance(o), orderStatus: o.status }));
  const collected = isFieldCollected(v.method);
  const now = new Date();
  const completed = await getDb().transaction(async (tx) => {
    await tx.insert(payment).values({
      paymentNo: newPaymentNo(now),
      orderId: o.id,
      customerId: o.customerId,
      paymentStage: 'ONSITE',
      method: v.method,
      amount: v.amount,
      status: 'APPROVED',
      approvedAt: now,
      collectedByTechId: collected ? techId : null,
      createdBy: techId,
      updatedBy: techId,
    });
    // 현장 영수 금액(work_order.received_amount)
    await tx
      .update(workOrder)
      .set({
        receivedAmount: sql`${workOrder.receivedAmount} + ${v.amount}`,
        updatedAt: now,
        updatedBy: techId,
      })
      .where(eq(workOrder.orderId, o.id));
    if (v.approvalNo)
      await tx
        .insert(activityLog)
        .values({
          orderId: o.id,
          actorType: 'TECHNICIAN',
          actorId: techId,
          activityType: 'NOTE',
          content: `현장 카드 승인번호 ${v.approvalNo}`,
        });
    return applyPayment(tx, o, v.amount, techId);
  });
  await notifyOrder('PAYMENT_DONE', o.id, { 결제금액: won(v.amount) });
  return { completed };
}

/** F-TEC-PAY-01 고객에게 결제 요청: 앱(알림톡) 또는 결제 링크 문자. 결제는 고객이 C-PAY-020 에서 한다 */
export async function requestCustomerPayment(o: OrderRow, channel: 'APP' | 'LINK', origin: string) {
  const balance = orderBalance(o);
  if (o.status !== 'WORK_DONE' || balance <= 0) throw new UserError('결제할 금액이 없습니다.');
  await notifyOrder(channel === 'APP' ? 'PAYMENT_REQUEST' : 'PAYMENT_LINK', o.id, {
    결제금액: won(balance),
    결제링크: payUrl(origin, o.orderNo),
  });
}

export async function techRequestPayment(
  techId: number,
  v: { orderNo: string; channel: 'APP' | 'LINK' },
  origin: string,
) {
  const m = await mainOnly(techId, v.orderNo);
  await requestCustomerPayment(await orderByNo(m.o.orderNo), v.channel, origin);
}

/** 미수로 남기기(T-PAY-010): 결제 상태 RECEIVABLE + [미수금] 메모(BR-081 결제될 때까지 정산 제외) */
export async function markReceivable(
  o: OrderRow,
  reason: string,
  actor: { type: 'TECHNICIAN' | 'ADMIN'; id: number },
) {
  fail(checkReceivable({ orderStatus: o.status, balance: orderBalance(o), reason }));
  const now = new Date();
  const today = kstDate(now);
  await getDb().transaction(async (tx) => {
    const rows = await tx
      .update(serviceOrder)
      .set({ paymentStatus: 'RECEIVABLE', updatedAt: now, updatedBy: actor.id })
      .where(
        and(
          eq(serviceOrder.id, o.id),
          eq(serviceOrder.status, 'WORK_DONE'),
          eq(serviceOrder.paidAmount, o.paidAmount),
        ),
      )
      .returning({ id: serviceOrder.id });
    if (!rows.length) throw new UserError('다른 곳에서 먼저 처리되었습니다. 새로고침 후 다시 확인해 주세요.');
    await tx.insert(memo).values({
      ownerType: actor.type,
      ownerId: actor.id,
      headerCode: 'RECEIVABLE',
      content: `미수 ${won(orderBalance(o))}: ${reason}`.slice(0, 1000),
      relatedOrderId: o.id,
      startDate: today,
      endDate: today,
      createdBy: actor.id,
      updatedBy: actor.id,
    });
  });
}

export async function techMarkReceivable(techId: number, v: { orderNo: string; reason: string }) {
  const m = await mainOnly(techId, v.orderNo);
  await markReceivable(await orderByNo(m.o.orderNo), v.reason, { type: 'TECHNICIAN', id: techId });
}

/* ---------- C-PAY-020 고객 작업 후 결제 ---------- */

export async function getCustomerPayment(customerId: number, orderNo: string) {
  const [o] = await getDb()
    .select()
    .from(serviceOrder)
    .where(and(eq(serviceOrder.orderNo, orderNo), eq(serviceOrder.customerId, customerId)));
  if (!o) return null;
  return { ...amountSummary(o), payments: await paymentsOf(o.id) };
}
export type CustomerPaymentState = NonNullable<Awaited<ReturnType<typeof getCustomerPayment>>>;

/**
 * F-CUS-PAY-02 작업 후 앱 결제 확인: PG 서버에 다시 조회해 금액이 잔액과 같을 때만 승인(위변조 방지).
 * 결제 시도마다 payment 1행(POSTPAY, APPROVED/FAILED). 승인되면 주문 완료.
 */
export async function confirmPostPayment(customerId: number, orderNo: string, paymentId: string) {
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
  const balance = orderBalance(o);
  if (o.status !== 'WORK_DONE' || balance <= 0) throw new UserError('결제할 금액이 없습니다.');
  const gw = createPaymentGateway();
  const r = await gw.verify(paymentId, balance);
  await db.transaction(async (tx) => {
    await tx.insert(payment).values({
      paymentNo,
      orderId: o.id,
      customerId,
      paymentStage: 'POSTPAY',
      method: r.method ?? 'CARD',
      amount: r.ok ? r.amount : balance,
      status: r.ok ? 'APPROVED' : 'FAILED',
      pgProvider: gw.provider,
      pgTid: r.pgTid,
      approvedAt: r.approvedAt,
      failReason: r.failReason?.slice(0, 300) ?? null,
      receiptUrl: r.receiptUrl,
      createdBy: customerId,
      updatedBy: customerId,
    });
    if (r.ok) await applyPayment(tx, o, r.amount, customerId);
  });
  if (r.ok) await notifyOrder('PAYMENT_DONE', o.id, { 결제금액: won(r.amount) });
  return { ok: r.ok, failReason: r.failReason };
}

/* ---------- 증빙 (F-CUS-PAY-03 · F-TEC-PAY-03 · F-ADM-PAY-05) ---------- */

const ACTIVE_DOC = ['REQUESTED', 'ISSUED', 'FAILED'];

/**
 * 증빙 신청: 결제 1건당 진행 중인 증빙 1건. 현금영수증은 바로 발행 어댑터로 보내고(실패하면 FAILED로 남아 A-PAY-050에서 다시 발행),
 * 세금계산서는 REQUESTED 로 두고 정산 담당이 홈택스 발행 후 승인번호를 입력한다.
 */
export async function requestTaxDoc(
  orderId: number,
  v: { paymentId: number; docType: string; identityNo: string },
  actor: { type: 'CUSTOMER' | 'TECHNICIAN' | 'ADMIN'; id: number },
) {
  const db = getDb();
  const [p] = await db
    .select()
    .from(payment)
    .where(and(eq(payment.id, v.paymentId), eq(payment.orderId, orderId)));
  if (!p || p.status !== 'APPROVED') throw new UserError('증빙을 신청할 결제를 찾을 수 없습니다.');
  fail(checkTaxDocInput({ docType: v.docType, identityNo: v.identityNo, method: p.method }));
  const [dup] = await db
    .select({ id: taxDocument.id })
    .from(taxDocument)
    .where(and(eq(taxDocument.paymentId, p.id), inArray(taxDocument.issueStatus, ACTIVE_DOC)));
  if (dup) throw new UserError('이 결제는 이미 증빙을 신청했습니다.');
  const { supply, vat } = splitVat(p.amount);
  const [doc] = await db
    .insert(taxDocument)
    .values({
      paymentId: p.id,
      docType: v.docType,
      identityNo: encrypt(v.identityNo.replace(/\D/g, '')),
      supplyAmount: supply,
      vatAmount: vat,
      totalAmount: p.amount,
      issueStatus: 'REQUESTED',
      requestedBy: actor.type,
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning();
  if (v.docType !== 'TAX_INVOICE') await issueCashReceipt(doc!, actor.id);
}

function receiptIdOf(docId: number) {
  return `CR${String(docId).padStart(10, '0')}`;
}

async function issueCashReceipt(doc: typeof taxDocument.$inferSelect, actorId: number | null) {
  assertTaxDocTransition(doc.issueStatus, 'ISSUED');
  const r = await createReceiptIssuer()
    .issueCashReceipt({
      receiptId: receiptIdOf(doc.id),
      purpose: doc.docType === 'CASH_RECEIPT_INCOME' ? 'INCOME' : 'EXPENSE',
      identityNo: decrypt(doc.identityNo) ?? '',
      totalAmount: doc.totalAmount,
      vatAmount: doc.vatAmount,
      orderName: '에어컨 청소',
    })
    .catch((e: Error) => ({ ok: false, issuedNo: null, failReason: e.message }));
  const now = new Date();
  await getDb()
    .update(taxDocument)
    .set({
      issueStatus: r.ok ? 'ISSUED' : 'FAILED',
      issuedNo: r.issuedNo,
      issuedAt: r.ok ? now : null,
      failReason: r.ok ? null : (r.failReason?.slice(0, 300) ?? '발행 실패'),
      updatedAt: now,
      updatedBy: actorId,
    })
    .where(and(eq(taxDocument.id, doc.id), eq(taxDocument.issueStatus, doc.issueStatus)));
  return r;
}

export async function customerRequestTaxDoc(
  customerId: number,
  v: { orderNo: string; paymentId: number; docType: string; identityNo: string },
) {
  const [o] = await getDb()
    .select({ id: serviceOrder.id })
    .from(serviceOrder)
    .where(and(eq(serviceOrder.orderNo, v.orderNo), eq(serviceOrder.customerId, customerId)));
  if (!o) throw new UserError('예약을 찾을 수 없습니다.');
  await requestTaxDoc(o.id, v, { type: 'CUSTOMER', id: customerId });
}

export async function techRequestTaxDoc(
  techId: number,
  v: { orderNo: string; paymentId: number; docType: string; identityNo: string },
) {
  const m = await mainOnly(techId, v.orderNo);
  await requestTaxDoc(m.o.id, v, { type: 'TECHNICIAN', id: techId });
}

/* ---------- 관리자 목록 공통 ---------- */

const kstStart = (d: string) => new Date(`${d}T00:00:00+09:00`);
const nextDay = (d: string) => new Date(kstStart(d).getTime() + 86_400_000);

async function techNames(ids: (number | null)[]) {
  const list = [...new Set(ids.filter((x): x is number => x !== null))];
  if (!list.length) return new Map<number, string>();
  const rows = await getDb()
    .select({ id: technician.id, name: technician.name, displayName: technician.displayName })
    .from(technician)
    .where(inArray(technician.id, list));
  return new Map(rows.map((t) => [t.id, t.displayName || t.name]));
}

async function customerNames(ids: number[]) {
  const list = [...new Set(ids)];
  if (!list.length) return new Map<number, string>();
  const rows = await getDb()
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(inArray(customer.id, list));
  return new Map(rows.map((c) => [c.id, maskName(decrypt(c.name))]));
}

/* ---------- A-PAY-010 결제 내역 · A-PAY-020 결제 실패 ---------- */

export interface PaymentSearch {
  from: string;
  to: string;
  method: string | null;
  status: string | null;
  orderNo: string | null;
}

export async function listPayments(filter: BranchFilter, q: PaymentSearch) {
  const conds: (SQL | undefined)[] = [
    gte(payment.createdAt, kstStart(q.from)),
    lt(payment.createdAt, nextDay(q.to)),
    q.method ? eq(payment.method, q.method) : undefined,
    q.status ? eq(payment.status, q.status) : undefined,
    q.orderNo ? eq(serviceOrder.orderNo, q.orderNo) : undefined,
    branchCond(filter),
  ];
  const rows = await getDb()
    .select({
      p: payment,
      orderNo: serviceOrder.orderNo,
      orderId: serviceOrder.id,
      orderStatus: serviceOrder.status,
      balance: sql<number>`greatest(${serviceOrder.totalAmount} - ${serviceOrder.paidAmount}, 0)`,
    })
    .from(payment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, payment.orderId))
    .where(and(...conds))
    .orderBy(desc(payment.createdAt))
    .limit(500);
  const ids = rows.map((r) => r.p.id);
  const refunds = ids.length ? await getDb().select().from(refund).where(inArray(refund.paymentId, ids)) : [];
  const techs = await techNames(rows.map((r) => r.p.collectedByTechId));
  return rows.map((r) => ({
    id: r.p.id,
    paymentNo: r.p.paymentNo,
    orderId: r.orderId,
    orderNo: r.orderNo,
    orderStatus: r.orderStatus,
    balance: Number(r.balance),
    stage: r.p.paymentStage,
    method: r.p.method,
    amount: r.p.amount,
    status: r.p.status,
    pgProvider: r.p.pgProvider,
    refunded: refunds
      .filter((x) => x.paymentId === r.p.id && x.status === 'DONE')
      .reduce((s, x) => s + x.amount, 0),
    collectedBy: r.p.collectedByTechId ? (techs.get(r.p.collectedByTechId) ?? '') : '',
    approvedAt: r.p.approvedAt,
    createdAt: r.p.createdAt,
    failReason: r.p.failReason,
  }));
}
export type PaymentListRow = Awaited<ReturnType<typeof listPayments>>[number];

/** PG 대사(F-ADM-PAY-01): 승인된 PG 결제를 PG 서버에 다시 조회해 금액·상태가 맞는지 본다 */
export async function reconcilePayment(paymentId: number, filter: BranchFilter) {
  const [r] = await getDb()
    .select({ p: payment })
    .from(payment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, payment.orderId))
    .where(and(eq(payment.id, paymentId), branchCond(filter)));
  if (!r) throw new UserError('결제를 찾을 수 없습니다.');
  const p = r.p;
  if (!p.pgProvider) return { match: true, message: '현장 결제(PG 거치지 않음)라 대사 대상이 아닙니다.' };
  if (p.status !== 'APPROVED') return { match: true, message: '승인되지 않은 결제입니다.' };
  const id = p.pgProvider === 'MOCK' ? (p.pgTid ?? p.paymentNo) : p.paymentNo;
  const v = await createPaymentGateway().verify(id, p.amount);
  return v.ok
    ? { match: true, message: `일치: PG 승인 ${won(v.amount)}` }
    : { match: false, message: `불일치: ${v.failReason ?? 'PG 확인 실패'}` };
}

/** F-ADM-PAY-02 결제 링크 다시 보내기: 작업완료(잔액 있음) → C-PAY-020, 작업 전 선결제 미결제 → C-PAY-010 */
export async function resendPaymentLink(orderId: number, filter: BranchFilter, origin: string) {
  const o = await orderById(orderId, filter);
  if (o.status === 'WORK_DONE') return requestCustomerPayment(o, 'LINK', origin);
  if (o.paymentStatus === 'UNPAID' && !['CANCELED', 'COMPLETED'].includes(o.status) && o.totalAmount > 0) {
    await notifyOrder('PAYMENT_LINK', o.id, {
      결제금액: won(o.totalAmount),
      결제링크: `${origin}/reserve/pay/${o.orderNo}`,
    });
    return;
  }
  throw new UserError('결제할 금액이 없는 주문입니다.');
}

/* ---------- A-PAY-030 환불 ---------- */

export async function listRefunds(filter: BranchFilter, q: { from: string; to: string }) {
  const rows = await getDb()
    .select({
      r: refund,
      paymentNo: payment.paymentNo,
      method: payment.method,
      payAmount: payment.amount,
      orderNo: serviceOrder.orderNo,
    })
    .from(refund)
    .innerJoin(payment, eq(payment.id, refund.paymentId))
    .innerJoin(serviceOrder, eq(serviceOrder.id, payment.orderId))
    .where(
      and(gte(refund.createdAt, kstStart(q.from)), lt(refund.createdAt, nextDay(q.to)), branchCond(filter)),
    )
    .orderBy(desc(refund.createdAt))
    .limit(500);
  return rows.map((x) => ({
    id: x.r.id,
    orderNo: x.orderNo,
    paymentNo: x.paymentNo,
    method: x.method,
    payAmount: x.payAmount,
    amount: x.r.amount,
    cancelFee: x.r.cancelFee,
    reasonCode: x.r.reasonCode,
    reasonDetail: x.r.reasonDetail,
    status: x.r.status,
    manual: !x.r.pgCancelTid,
    refundedAt: x.r.refundedAt,
  }));
}
export type RefundListRow = Awaited<ReturnType<typeof listRefunds>>[number];

/** 환불 등록 창: 접수번호로 승인 결제와 환불 가능 금액 조회 */
export async function refundablePayments(orderNo: string, filter: BranchFilter) {
  const [o] = await getDb()
    .select()
    .from(serviceOrder)
    .where(and(eq(serviceOrder.orderNo, orderNo), branchCond(filter)));
  if (!o) throw new UserError('주문을 찾을 수 없습니다.');
  const db = getDb();
  const pays = await db
    .select()
    .from(payment)
    .where(and(eq(payment.orderId, o.id), eq(payment.status, 'APPROVED')))
    .orderBy(asc(payment.id));
  const refunds = pays.length
    ? await db
        .select()
        .from(refund)
        .where(
          inArray(
            refund.paymentId,
            pays.map((p) => p.id),
          ),
        )
    : [];
  return {
    orderNo: o.orderNo,
    status: o.status,
    payments: pays.map((p) => ({
      id: p.id,
      paymentNo: p.paymentNo,
      method: p.method,
      amount: p.amount,
      pg: Boolean(p.pgProvider),
      refundable: refundableOf(
        p.amount,
        refunds.filter((r) => r.paymentId === p.id && r.status === 'DONE'),
      ),
    })),
  };
}

/**
 * F-ADM-PAY-03 환불: PG 결제는 PG 취소 연동, 현장 결제(현금·계좌·카드단말)는 직접 돌려준 뒤 기록만 남긴다.
 * refund 1행(INSERT ONLY) + 주문 결제 상태(PARTIAL_REFUND/REFUNDED). 주문 상태는 바꾸지 않는다(작업 전 취소는 A-ORD-020 취소).
 */
export async function createRefund(
  v: { paymentId: number; amount: number; fee: number; reasonCode: string; reasonDetail: string | null },
  filter: BranchFilter,
  adminId: number,
) {
  const db = getDb();
  const [r] = await db
    .select({ p: payment, o: serviceOrder })
    .from(payment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, payment.orderId))
    .where(and(eq(payment.id, v.paymentId), branchCond(filter)));
  if (!r || r.p.status !== 'APPROVED') throw new UserError('환불할 결제를 찾을 수 없습니다.');
  const prev = await db.select().from(refund).where(eq(refund.paymentId, r.p.id));
  const refundable = refundableOf(
    r.p.amount,
    prev.filter((x) => x.status === 'DONE'),
  );
  fail(checkRefund({ refundable, amount: v.amount, fee: v.fee, reasonCode: v.reasonCode }));
  let cancelTid: string | null = null;
  if (r.p.pgProvider) {
    const cancelId = r.p.pgProvider === 'MOCK' ? (r.p.pgTid ?? r.p.paymentNo) : r.p.paymentNo;
    const c = await createPaymentGateway().cancel(cancelId, v.amount, v.reasonDetail ?? v.reasonCode);
    if (!c.ok)
      throw new UserError(
        `PG 취소에 실패했습니다(${c.failReason ?? 'PG 오류'}). 잠시 후 다시 시도해 주세요.`,
      );
    cancelTid = c.cancelTid;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(refund).values({
      paymentId: r.p.id,
      amount: v.amount,
      reasonCode: v.reasonCode,
      reasonDetail: v.reasonDetail,
      cancelFee: v.fee,
      status: 'DONE',
      pgCancelTid: cancelTid,
      requestedBy: 'ADMIN',
      approvedBy: adminId,
      refundedAt: now,
      createdBy: adminId,
      updatedBy: adminId,
    });
    const [{ total }] = (await tx
      .select({ total: sql<number>`coalesce(sum(${refund.amount}), 0)::int` })
      .from(refund)
      .innerJoin(payment, eq(payment.id, refund.paymentId))
      .where(and(eq(payment.orderId, r.o.id), eq(refund.status, 'DONE')))) as [{ total: number }];
    await tx
      .update(serviceOrder)
      .set({
        paymentStatus: paymentStatusAfterRefund(r.o.paymentStatus, r.o.paidAmount, total),
        updatedAt: now,
        updatedBy: adminId,
      })
      .where(eq(serviceOrder.id, r.o.id));
  });
}

/* ---------- A-PAY-040 미수금 ---------- */

export async function listReceivables(filter: BranchFilter) {
  const db = getDb();
  const rows = await db
    .select({ o: serviceOrder, techId: workOrder.mainTechnicianId })
    .from(serviceOrder)
    .leftJoin(workOrder, eq(workOrder.orderId, serviceOrder.id))
    .where(
      and(
        eq(serviceOrder.status, 'WORK_DONE'),
        eq(serviceOrder.paymentStatus, 'RECEIVABLE'),
        branchCond(filter),
      ),
    )
    .orderBy(asc(serviceOrder.completedAt))
    .limit(500);
  const ids = rows.map((r) => r.o.id);
  const memos = ids.length
    ? await db
        .select()
        .from(memo)
        .where(and(inArray(memo.relatedOrderId, ids), eq(memo.headerCode, 'RECEIVABLE')))
        .orderBy(desc(memo.id))
    : [];
  const [techs, names] = await Promise.all([
    techNames(rows.map((r) => r.techId)),
    customerNames(rows.map((r) => r.o.customerId)),
  ]);
  const now = Date.now();
  return rows.map((r) => ({
    orderId: r.o.id,
    orderNo: r.o.orderNo,
    customerName: names.get(r.o.customerId) ?? '',
    techName: r.techId ? (techs.get(r.techId) ?? '') : '',
    completedAt: r.o.completedAt,
    days: r.o.completedAt ? Math.floor((now - r.o.completedAt.getTime()) / 86_400_000) : 0,
    totalAmount: r.o.totalAmount,
    paidAmount: r.o.paidAmount,
    balance: orderBalance(r.o),
    memos: memos
      .filter((m) => m.relatedOrderId === r.o.id)
      .map((m) => ({ id: m.id, content: m.content, ownerType: m.ownerType, createdAt: m.createdAt })),
  }));
}
export type ReceivableRow = Awaited<ReturnType<typeof listReceivables>>[number];

export async function addReceivableMemo(
  v: { orderId: number; content: string },
  filter: BranchFilter,
  adminId: number,
) {
  const o = await orderById(v.orderId, filter);
  const today = kstDate(new Date());
  await getDb().insert(memo).values({
    ownerType: 'ADMIN',
    ownerId: adminId,
    headerCode: 'RECEIVABLE',
    content: v.content,
    relatedOrderId: o.id,
    startDate: today,
    endDate: today,
    createdBy: adminId,
    updatedBy: adminId,
  });
}

/** F-ADM-PAY-04 입금 확인: 회사 계좌 입금·방문 수금 등 관리자가 받은 결제를 기록(POSTPAY) → 전액이면 완료 */
export async function adminCollect(
  v: { orderId: number; method: string; amount: number },
  filter: BranchFilter,
  adminId: number,
) {
  const o = await orderById(v.orderId, filter);
  const balance = orderBalance(o);
  if (o.status !== 'WORK_DONE' || balance <= 0) throw new UserError('결제할 금액이 없습니다.');
  if (v.amount !== balance)
    throw new ValidationFailed({ amount: `입금 금액이 남은 금액(${won(balance)})과 다릅니다.` });
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.insert(payment).values({
      paymentNo: newPaymentNo(now),
      orderId: o.id,
      customerId: o.customerId,
      paymentStage: 'POSTPAY',
      method: v.method,
      amount: v.amount,
      status: 'APPROVED',
      approvedAt: now,
      createdBy: adminId,
      updatedBy: adminId,
    });
    await applyPayment(tx, o, v.amount, adminId);
  });
  await notifyOrder('PAYMENT_DONE', o.id, { 결제금액: won(v.amount) });
}

/* ---------- A-PAY-050 증빙 ---------- */

export async function listTaxDocs(filter: BranchFilter, status: string | null) {
  const rows = await getDb()
    .select({
      d: taxDocument,
      paymentNo: payment.paymentNo,
      method: payment.method,
      orderNo: serviceOrder.orderNo,
    })
    .from(taxDocument)
    .innerJoin(payment, eq(payment.id, taxDocument.paymentId))
    .innerJoin(serviceOrder, eq(serviceOrder.id, payment.orderId))
    .where(and(status ? eq(taxDocument.issueStatus, status) : undefined, branchCond(filter)))
    .orderBy(desc(taxDocument.id))
    .limit(500);
  return rows.map((x) => ({
    id: x.d.id,
    orderNo: x.orderNo,
    paymentNo: x.paymentNo,
    method: x.method,
    docType: x.d.docType,
    identityMasked: maskIdentity(decrypt(x.d.identityNo) ?? ''),
    supplyAmount: x.d.supplyAmount,
    vatAmount: x.d.vatAmount,
    totalAmount: x.d.totalAmount,
    issueStatus: x.d.issueStatus,
    issuedNo: x.d.issuedNo,
    issuedAt: x.d.issuedAt,
    failReason: x.d.failReason,
    requestedBy: x.d.requestedBy,
    createdAt: x.d.createdAt,
  }));
}
export type TaxDocRow = Awaited<ReturnType<typeof listTaxDocs>>[number];

/** 휴대폰 010-****-5678 · 사업자 220-**-*2517 */
export function maskIdentity(d: string): string {
  if (!d) return '';
  if (d.length === 10 && !d.startsWith('01')) return `${d.slice(0, 3)}-**-*${d.slice(6)}`;
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

async function taxDocInScope(id: number, filter: BranchFilter) {
  const [r] = await getDb()
    .select({ d: taxDocument })
    .from(taxDocument)
    .innerJoin(payment, eq(payment.id, taxDocument.paymentId))
    .innerJoin(serviceOrder, eq(serviceOrder.id, payment.orderId))
    .where(and(eq(taxDocument.id, id), branchCond(filter)));
  if (!r) throw new UserError('증빙을 찾을 수 없습니다.');
  return r.d;
}

/** 원문 번호 보기 (세금계산서 발행용) — 감사 로그(BR-100) */
export async function revealTaxIdentity(id: number, filter: BranchFilter, adminId: number) {
  const d = await taxDocInScope(id, filter);
  await writeAudit({
    actorId: adminId,
    action: 'VIEW_PII',
    targetTable: 'tax_document',
    targetId: d.id,
    detail: { field: 'identity_no' },
  });
  return decrypt(d.identityNo) ?? '';
}

/** F-ADM-PAY-05 발행(현금영수증 = 어댑터 재발행, 세금계산서 = 승인번호 입력)·취소 */
export async function taxDocAction(
  v: { taxDocId: number; action: 'ISSUE' | 'CANCEL'; issuedNo: string | null },
  filter: BranchFilter,
  adminId: number,
) {
  const d = await taxDocInScope(v.taxDocId, filter);
  const now = new Date();
  if (v.action === 'CANCEL') {
    assertTaxDocTransition(d.issueStatus, 'CANCELED');
    if (d.issueStatus === 'ISSUED' && d.docType !== 'TAX_INVOICE') {
      const c = await createReceiptIssuer().cancelCashReceipt(receiptIdOf(d.id));
      if (!c.ok) throw new UserError(`현금영수증 취소에 실패했습니다(${c.failReason ?? '오류'}).`);
    }
    await getDb()
      .update(taxDocument)
      .set({ issueStatus: 'CANCELED', updatedAt: now, updatedBy: adminId })
      .where(and(eq(taxDocument.id, d.id), eq(taxDocument.issueStatus, d.issueStatus)));
    return;
  }
  try {
    assertTaxDocTransition(d.issueStatus, 'ISSUED');
  } catch {
    throw new UserError('이미 발행했거나 취소한 증빙입니다.');
  }
  if (d.docType === 'TAX_INVOICE') {
    if (!v.issuedNo) throw new ValidationFailed({ issuedNo: '국세청 승인번호는 필수 입력값입니다.' });
    await getDb()
      .update(taxDocument)
      .set({
        issueStatus: 'ISSUED',
        issuedNo: v.issuedNo,
        issuedAt: now,
        failReason: null,
        updatedAt: now,
        updatedBy: adminId,
      })
      .where(and(eq(taxDocument.id, d.id), eq(taxDocument.issueStatus, d.issueStatus)));
    return;
  }
  const r = await issueCashReceipt(d, adminId);
  if (!r.ok) throw new UserError(`현금영수증 발행에 실패했습니다(${r.failReason ?? '오류'}).`);
}

export type { Actor };
