/**
 * 주문 업무 규칙: BR-020 이중예약, BR-030 취소 수수료, F-CUS-AUTH-05 탈퇴 가능 여부, 주문·고객 번호.
 * 기준값(취소 수수료 시간·금액)은 system_setting 에서 읽어 넘긴다(CLAUDE.md §5).
 */
import { kstYymmdd } from '../quote/quote-status';
import { ACTIVE_ORDER_STATUSES, type OrderStatus } from './order-status';

/* ---------- BR-030 취소 수수료 ---------- */

export interface CancelPolicyInput {
  /** 확정 방문 약속 일시 (service_order.promised_at) */
  promisedAt: Date | null;
  now: Date;
  /** 결제 완료 금액 (service_order.paid_amount) */
  paidAmount: number;
  /** CANCEL_FEE_HOURS: 방문 몇 시간 이내 취소부터 수수료 */
  feeHours: number;
  /** CANCEL_FEE_AMOUNT: 취소 수수료(원) */
  feeAmount: number;
}

/** BR-030 방문 feeHours 시간 이내 취소면 수수료(결제 금액 한도)를 빼고 환불 */
export function cancelPolicy(i: CancelPolicyInput): { withinFeeWindow: boolean; fee: number; refundAmount: number } {
  const withinFeeWindow =
    i.promisedAt !== null && i.promisedAt.getTime() - i.now.getTime() < i.feeHours * 60 * 60 * 1000;
  const fee = withinFeeWindow ? Math.min(Math.max(i.feeAmount, 0), Math.max(i.paidAmount, 0)) : 0;
  return { withinFeeWindow, fee, refundAmount: Math.max(i.paidAmount - fee, 0) };
}

/* ---------- BR-020 이중예약 ---------- */

/** 주소 비교 키: 도로명 주소 + 상세주소에서 공백을 없애고 소문자로 */
export function addressKey(roadAddress: string, detailAddress: string | null): string {
  return `${roadAddress}|${detailAddress ?? ''}`.replace(/\s+/g, '').toLowerCase();
}

export interface DuplicateCandidate {
  status: string;
  phoneHash: string | null;
  addressKey: string | null;
}

/** BR-020 같은 전화번호(해시) 또는 같은 주소의 미완료 주문 */
export function findDuplicateOrders<T extends DuplicateCandidate>(
  orders: readonly T[],
  target: { phoneHash: string | null; addressKey: string | null },
): T[] {
  return orders.filter(
    (o) =>
      ACTIVE_ORDER_STATUSES.includes(o.status as OrderStatus) &&
      ((target.phoneHash !== null && o.phoneHash === target.phoneHash) ||
        (target.addressKey !== null && o.addressKey === target.addressKey)),
  );
}

/* ---------- F-CUS-AUTH-05 탈퇴 ---------- */

export function canWithdraw(orderStatuses: readonly string[]): boolean {
  return !orderStatuses.some((s) => ACTIVE_ORDER_STATUSES.includes(s as OrderStatus));
}

/* ---------- 결제 상태 ---------- */

/** 환불 후 service_order.payment_status */
export function paymentStatusAfterRefund(current: string, paidAmount: number, refundedTotal: number): string {
  if (refundedTotal <= 0) return current;
  return refundedTotal >= paidAmount ? 'REFUNDED' : 'PARTIAL_REFUND';
}

/* ---------- 번호 ---------- */

/** 한국 시각 HHmm */
function kstHhmm(at: Date): string {
  return at.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).replace(':', '');
}

/** 같은 분 안의 n번째(1부터) 주문 일련: A1~A9, B1~B9 … Z9 */
export function orderNoSerial(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 26 * 9) throw new Error('같은 분에 접수할 수 있는 건수를 넘었습니다.');
  return `${String.fromCharCode(65 + Math.floor((n - 1) / 9))}${((n - 1) % 9) + 1}`;
}

/** 접수 번호 `2611221530A1` = 한국 시각 YYMMDDHHmm + 일련 (01 §2.5.1) */
export function formatOrderNo(at: Date, seq: number): string {
  return `${kstYymmdd(at)}${kstHhmm(at)}${orderNoSerial(seq)}`;
}

/** 고객 번호 `C2611000123` = C + 한국 날짜 YYMM + 6자리 일련 (01 §2.2.1) */
export function formatCustomerNo(at: Date, seq: number): string {
  return `C${kstYymmdd(at).slice(0, 4)}${String(seq).padStart(6, '0')}`;
}
