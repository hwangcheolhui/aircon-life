'use server';
// C-ORD-030 일정 변경·취소 서버 액션 · F-CUS-ORD-03 (취소는 즉시 + BR-030 환불, 일정 변경은 요청 → 상담원 승인)
import { changeRequestInput } from '@aircon/contracts';
import { UserError, handle, parse } from '@/server/action-result';
import { getCurrentCustomer } from '@/server/customer-session';
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
