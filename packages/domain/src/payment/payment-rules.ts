/**
 * 결제·증빙·환불 규칙 (단계 6: F-TEC-PAY-01~03, F-CUS-PAY-02·03, F-ADM-PAY-01~05, BR-081·082, 01 §3.1·§3.11).
 * 화면·서버가 같은 검증을 쓰도록 순수 함수로 둔다. 금액은 원 단위 정수(부가세 포함).
 */
import { MSG } from '../messages';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 기사가 현장에서 받는 결제 수단 (T-PAY-010). 앱 결제·결제 링크는 고객이 C-PAY-020 에서 PG로 낸다 */
export const FIELD_PAY_METHODS = ['ONSITE_CARD', 'BANK_TRANSFER', 'CASH'] as const;
export type FieldPayMethod = (typeof FIELD_PAY_METHODS)[number];

/** 잔액 = 청구 금액 − 결제 완료 금액 */
export function orderBalance(o: { totalAmount: number; paidAmount: number }): number {
  return Math.max(o.totalAmount - o.paidAmount, 0);
}

/** 결제 후 service_order.payment_status (01 §2.5.1). 일부만 낸 상태는 PREPAID(선결제·일부 결제) */
export function paymentStatusAfterPay(
  totalAmount: number,
  paidAmount: number,
): 'PAID' | 'PREPAID' | 'UNPAID' {
  if (paidAmount >= totalAmount && paidAmount > 0) return 'PAID';
  return paidAmount > 0 ? 'PREPAID' : 'UNPAID';
}

/** 01 §3.1 WORK_DONE → COMPLETED: paid_amount >= total_amount 이면 자동 전환 */
export function completionAfterPayment(o: {
  status: string;
  totalAmount: number;
  paidAmount: number;
}): boolean {
  return o.status === 'WORK_DONE' && o.paidAmount >= o.totalAmount;
}

/** BR-081 정산 대상: 완료 + 결제완료만. 미수(RECEIVABLE)는 결제가 끝나는 회차에 들어간다 */
export function settlementTargetOf(o: { status: string; paymentStatus: string }): boolean {
  return o.status === 'COMPLETED' && o.paymentStatus === 'PAID';
}

/** BR-082 · F-TEC-PAY-02: 기사가 직접 받은 돈(현금·계좌이체)은 collected_by_tech_id 로 남겨 정산(단계 7)에서 상계한다 */
export function isFieldCollected(method: string): boolean {
  return method === 'CASH' || method === 'BANK_TRANSFER';
}

export type FieldErrors = Record<string, string>;

/** F-TEC-PAY-01·02 현장 결제 검증: 작업완료 주문, 잔액 전액을 한 수단으로 받는다 */
export function checkCollect(i: {
  method: string;
  amount: number;
  balance: number;
  orderStatus: string;
}): FieldErrors {
  if (i.orderStatus !== 'WORK_DONE') return { form: '작업을 완료한 뒤에 결제를 받을 수 있습니다.' };
  if (i.balance <= 0) return { form: '결제할 금액이 없습니다.' };
  const e: FieldErrors = {};
  if (!(FIELD_PAY_METHODS as readonly string[]).includes(i.method)) e.method = MSG.required('결제 수단');
  if (!Number.isInteger(i.amount) || i.amount <= 0) e.amount = MSG.required('받은 금액');
  else if (i.amount !== i.balance) e.amount = `받은 금액이 결제할 금액(${won(i.balance)})과 다릅니다.`;
  return e;
}

/** 미수로 남기기(T-PAY-010 · A-PAY-040): 작업완료이고 잔액이 있을 때, 사유 필수 */
export function checkReceivable(i: { orderStatus: string; balance: number; reason: string }): FieldErrors {
  if (i.orderStatus !== 'WORK_DONE')
    return { form: '작업완료(결제 대기) 상태에서만 미수로 남길 수 있습니다.' };
  if (i.balance <= 0) return { form: '결제할 금액이 없습니다.' };
  return i.reason.trim() ? {} : { reason: MSG.required('미수 사유') };
}

/* ---------- 환불 (F-ADM-PAY-03) ---------- */

/** 결제 1건의 환불 가능 금액 = 결제 금액 − (이미 환불 + 이미 뗀 수수료) */
export function refundableOf(
  paymentAmount: number,
  refunds: readonly { amount: number; cancelFee: number }[],
): number {
  return Math.max(paymentAmount - refunds.reduce((s, r) => s + r.amount + r.cancelFee, 0), 0);
}

export function checkRefund(i: {
  refundable: number;
  amount: number;
  fee: number;
  reasonCode: string;
}): FieldErrors {
  const e: FieldErrors = {};
  if (!i.reasonCode) e.reasonCode = MSG.required('환불 사유');
  if (!Number.isInteger(i.fee) || i.fee < 0) e.fee = '수수료는 0원 이상이어야 합니다.';
  if (!Number.isInteger(i.amount) || i.amount <= 0) e.amount = MSG.required('환불 금액');
  else if (i.amount + Math.max(i.fee, 0) > i.refundable)
    e.amount = `환불 금액과 수수료의 합이 환불 가능 금액(${won(i.refundable)})을 넘습니다.`;
  return e;
}

/* ---------- 증빙 (F-CUS-PAY-03 · F-TEC-PAY-03 · F-ADM-PAY-05) ---------- */

export const TAX_DOC_TYPES = [
  'CASH_RECEIPT_INCOME',
  'CASH_RECEIPT_EXPENSE',
  'TAX_INVOICE',
  'CARD_SLIP',
] as const;
export type TaxDocType = (typeof TAX_DOC_TYPES)[number];

/** 결제 수단별 신청할 수 있는 증빙. 카드·간편결제는 카드 영수증(PG 영수증 링크)으로 대신한다 */
export function taxDocTypesFor(method: string): TaxDocType[] {
  return ['CASH', 'BANK_TRANSFER', 'VIRTUAL_ACCOUNT'].includes(method)
    ? ['CASH_RECEIPT_INCOME', 'CASH_RECEIPT_EXPENSE', 'TAX_INVOICE']
    : [];
}

/** 부가세 포함 금액 → 공급가·부가세 (부가세 = 합계 − round(합계 ÷ 1.1)) */
export function splitVat(total: number): { supply: number; vat: number } {
  const supply = Math.round(total / 1.1);
  return { supply, vat: total - supply };
}

/** 사업자등록번호 10자리 검증 숫자 확인 */
export function isValidBizNo(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 10) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const n = d.split('').map(Number);
  let sum = w.reduce((s, x, i) => s + x * n[i]!, 0);
  sum += Math.floor((n[8]! * 5) / 10);
  return (10 - (sum % 10)) % 10 === n[9];
}

/** 소득공제 = 휴대폰 번호(또는 현금영수증 카드 13~19자리), 지출증빙·세금계산서 = 사업자등록번호 */
export function checkTaxDocInput(i: { docType: string; identityNo: string; method: string }): FieldErrors {
  const allowed = taxDocTypesFor(i.method);
  if (!allowed.length) return { docType: '카드 결제는 카드 영수증으로 증빙합니다.' };
  if (!(allowed as string[]).includes(i.docType)) return { docType: MSG.required('증빙 종류') };
  const d = i.identityNo.replace(/\D/g, '');
  if (!d) return { identityNo: MSG.required('발급 번호') };
  if (i.docType === 'CASH_RECEIPT_INCOME') {
    const phone = /^01\d{8,9}$/.test(d);
    const card = d.length >= 13 && d.length <= 19;
    return phone || card ? {} : { identityNo: '휴대폰 번호 형식이 올바르지 않습니다.' };
  }
  return isValidBizNo(d) ? {} : { identityNo: '사업자등록번호가 올바르지 않습니다.' };
}

/** 01 §3.11 tax_document.issue_status 전이 */
export const TAX_DOC_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  REQUESTED: ['ISSUED', 'FAILED', 'CANCELED'],
  FAILED: ['ISSUED', 'FAILED', 'CANCELED'],
  ISSUED: ['CANCELED'],
  CANCELED: [],
};

export function assertTaxDocTransition(from: string, to: string): void {
  if (!(TAX_DOC_TRANSITIONS[from] ?? []).includes(to))
    throw new Error(`증빙 상태를 ${from}에서 ${to}(으)로 바꿀 수 없습니다.`);
}
