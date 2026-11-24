'use server';
// C-ORD-030 일정 변경·취소 서버 액션 · F-CUS-ORD-03 (취소는 즉시 + BR-030 환불, 일정 변경은 요청 → 상담원 승인)
// C-ORD-040 추가요금 동의/거절 · F-CUS-ORD-04 (BR-040, 단계 5-2)
import { changeRequestInput, extraChargeRespondInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { UserError, handle, parse } from '@/server/action-result';
import { getCurrentCustomer } from '@/server/customer-session';
import { respondByCustomer } from '@/server/extra-charges';
import { cancelByCustomer, requestReschedule } from '@/server/orders';

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
