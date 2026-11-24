'use server';
// C-ORD-030 일정 변경·취소 서버 액션 · F-CUS-ORD-03 (취소는 즉시 + BR-030 환불, 일정 변경은 요청 → 상담원 승인)
// C-ORD-040 추가요금 동의/거절 · F-CUS-ORD-04 (BR-040, 단계 5-2)
// C-PAY-020 작업 후 결제 · F-CUS-PAY-02, C-PAY-030 증빙 신청 · F-CUS-PAY-03 (단계 6)
import { changeRequestInput, extraChargeRespondInput, taxDocRequestInput, z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { UserError, handle, parse } from '@/server/action-result';
import { getCurrentCustomer } from '@/server/customer-session';
import { respondByCustomer } from '@/server/extra-charges';
import { cancelByCustomer, requestReschedule } from '@/server/orders';
import { confirmPostPayment, customerRequestTaxDoc } from '@/server/payments';

export async function submitChange(values: Record<string, unknown>) {
  return handle(async () => {
    const c = await getCurrentCustomer();
    if (!c || c.demo) throw new UserError('로그인이 필요합니다.');
    const v = parse(changeRequestInput, values);
    if (v.requestType === 'CANCEL') {
      const r = await cancelByCustomer(c.id, v.orderNo, v.reason);
      return { kind: 'CANCELED' as const, refunded: r.refunded };
    }
    await requestReschedule(c.id, v.orderNo, v.requestedDate!, v.requestedHour!, v.reason);
    return { kind: 'REQUESTED' as const };
  });
}

/** F-CUS-ORD-04 추가요금 동의/거절 → 기사에게 결과 알림. 거절한 항목은 청구하지 않는다(BR-040) */
export async function respondExtraCharge(values: Record<string, unknown>) {
  return handle(async () => {
    const c = await getCurrentCustomer();
    if (!c || c.demo) throw new UserError('로그인이 필요합니다.');
    const v = parse(extraChargeRespondInput, values);
    await respondByCustomer(c.id, v.orderNo, v.chargeId, v.decision === 'AGREE');
    revalidatePath(`/orders/${v.orderNo}`, 'layout');
  });
}

/* ---------- 단계 6 C-PAY-020 작업 후 결제 · C-PAY-030 증빙 신청 ---------- */

/** F-CUS-PAY-02 결제창 결과 확인: PG 재조회 후 잔액과 같을 때만 승인 → 주문 완료 */
export async function completePostPayment(orderNo: string, paymentId: string) {
  return handle(async () => {
    const c = await getCurrentCustomer();
    if (!c || c.demo) throw new UserError('로그인이 필요합니다.');
    const r = await confirmPostPayment(c.id, parse(z.string().max(20), orderNo), parse(z.string().max(100), paymentId));
    revalidatePath(`/orders/${orderNo}`, 'layout');
    return r;
  });
}

/** F-CUS-PAY-03 현금영수증·세금계산서 신청 */
export async function requestReceipt(values: Record<string, unknown>) {
  return handle(async () => {
    const c = await getCurrentCustomer();
    if (!c || c.demo) throw new UserError('로그인이 필요합니다.');
    const v = parse(taxDocRequestInput, values);
    await customerRequestTaxDoc(c.id, v);
    revalidatePath(`/orders/${v.orderNo}`, 'layout');
  });
}
