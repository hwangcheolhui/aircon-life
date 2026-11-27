'use server';
// C-ORD-030 일정 변경·취소 서버 액션 · F-CUS-ORD-03 (취소는 즉시 + BR-030 환불, 일정 변경은 요청 → 상담원 승인)
// C-ORD-040 추가요금 동의/거절 · F-CUS-ORD-04 (BR-040, 단계 5-2)
// C-PAY-020 작업 후 결제 · F-CUS-PAY-02, C-PAY-030 증빙 신청 · F-CUS-PAY-03 (단계 6), C-AS-010 AS 요청 · F-CUS-AS-01 (단계 8)
// 단계 9: C-REV-010 후기 · F-CUS-REV-01(BR-090), C-PAY-010 쿠폰 적용 · F-CUS-PAY-04, 안심번호 연결(C-ORD-020)
import { applyCouponInput, changeRequestInput, customerAsInput, extraChargeRespondInput, reviewInput, taxDocRequestInput, z } from '@aircon/contracts';
import { createSafeNumberProvider } from '@aircon/integrations';
import { applyCoupon } from '@/server/coupons';
import { getCustomerOrder } from '@/server/orders';
import { submitReview } from '@/server/reviews';
import { revalidatePath } from 'next/cache';
import { UserError, handle, parse } from '@/server/action-result';
import { getCurrentCustomer } from '@/server/customer-session';
import { respondByCustomer } from '@/server/extra-charges';
import { cancelByCustomer, requestReschedule } from '@/server/orders';
import { confirmPostPayment, customerRequestTaxDoc } from '@/server/payments';
import { createCustomerAs } from '@/server/voc';

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

/** C-AS-010 AS 요청 · F-CUS-AS-01 (사진 3장까지, BR-050 보증 판정, BR-051 진행 중 1건) */
export async function submitAs(form: FormData) {
  return handle(async () => {
    const c = await getCurrentCustomer();
    if (!c || c.demo) throw new UserError('로그인이 필요합니다.');
    const v = parse(customerAsInput, { orderNo: form.get('orderNo'), reason: form.get('reason'), content: form.get('content') });
    const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
    const r = await createCustomerAs(c.id, v, files);
    revalidatePath(`/orders/${v.orderNo}`);
    return { asNo: r.asNo };
  });
}

/* ---------- 단계 9 ---------- */

/** F-CUS-REV-01 후기 등록 (사진 3장까지). BR-090 저평점은 서버에서 VOC 자동 생성 */
export async function sendReview(form: FormData) {
  return handle(async () => {
    const c = await getCurrentCustomer();
    if (!c || c.demo) throw new UserError('로그인이 필요합니다.');
    const v = parse(reviewInput, {
      orderNo: form.get('orderNo'),
      rating: form.get('rating'),
      npsScore: form.get('npsScore'),
      tags: form.getAll('tags'),
      content: form.get('content'),
    });
    const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
    await submitReview(c.id, v, files);
    revalidatePath(`/orders/${v.orderNo}`, 'layout');
  });
}

/** F-CUS-PAY-04 쿠폰 적용·해제 (결제 전) */
export async function chooseCoupon(values: Record<string, unknown>) {
  return handle(async () => {
    const c = await getCurrentCustomer();
    if (!c || c.demo) throw new UserError('로그인이 필요합니다.');
    const v = parse(applyCouponInput, values);
    const r = await applyCoupon(c.id, v.orderNo, v.customerCouponId);
    revalidatePath(`/reserve/pay/${v.orderNo}`);
    return r;
  });
}

/** 안심번호 받기 (기사와 통화, 실제 번호 비공개). 배정된 진행 중 예약만 */
export async function safeCallNumber(orderNo: string) {
  return handle(async () => {
    const c = await getCurrentCustomer();
    if (!c || c.demo) throw new UserError('로그인이 필요합니다.');
    const o = await getCustomerOrder(c.id, parse(z.string().max(20), orderNo));
    if (!o || !o.tech || !['ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS'].includes(o.status)) throw new UserError('기사님이 배정된 진행 중 예약에서만 연결할 수 있어요.');
    const r = await createSafeNumberProvider().issue({ orderNo: o.orderNo, caller: 'CUSTOMER' });
    if (!r.ok) throw new UserError(r.failReason ?? '안심번호를 받지 못했어요.');
    return { number: r.number! };
  });
}
