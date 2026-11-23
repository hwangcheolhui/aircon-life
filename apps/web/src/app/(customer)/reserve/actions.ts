'use server';
// C-RSV-030·C-PAY-010 고객 예약·결제 서버 액션 (F-CUS-RSV-03·05, F-CUS-PAY-01). 금액·잔여는 항상 서버가 다시 계산·확인한다.
import { reservationInput, z } from '@aircon/contracts';
import { UserError, handle, parse } from '@/server/action-result';
import { getCurrentCustomer } from '@/server/customer-session';
import {
  DEMO_ORDER_NO,
  confirmPayment,
  createReservation,
  loadReservableQuote,
  newPaymentNo,
  priceForVisit,
  switchToOnsite,
} from '@/server/orders';

async function me() {
  const c = await getCurrentCustomer();
  if (!c) throw new UserError('로그인이 필요합니다. 다시 로그인해 주세요.');
  return c;
}

const previewInput = z.object({
  quoteNo: z.string().min(1).max(20),
  r: z.string().max(4000).nullable(),
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotHour: z.number().int().min(0).max(23),
});

/** F-CUS-RSV-03 예약 확인 금액: 견적 단가 + 고른 일시의 야간·휴일 할증 */
export async function previewReservation(input: z.input<typeof previewInput>) {
  return handle(async () => {
    await me();
    const v = parse(previewInput, input);
    const q = await loadReservableQuote(v.quoteNo, v.r);
    if (!q) throw new UserError('견적을 찾을 수 없습니다.');
    const p = await priceForVisit(q.snapshot, v.slotDate, v.slotHour);
    return {
      items: p.items.map((i) => ({ itemType: i.itemType, name: i.name, quantity: i.quantity, amount: i.amount })),
      totalAmount: p.totalAmount,
    };
  });
}

/** F-CUS-RSV-05 예약 확정 → 선결제면 결제 화면, 현장 결제면 완료 화면 경로 */
export async function confirmReservation(values: unknown, r: string | null) {
  return handle(async () => {
    const c = await me();
    const v = parse(reservationInput, values);
    const res = await createReservation(c, v, r);
    if (!res.ok) return res;
    // 체험 모드는 주문을 저장하지 않으므로 금액을 주소에 담는다
    const demo = res.demo ? `?a=${res.totalAmount}` : '';
    const path = res.needsPayment ? `/reserve/pay/${res.orderNo}${demo}` : `/reserve/done/${res.orderNo}${demo}`;
    return { ok: true as const, path };
  });
}

/** C-PAY-010 결제 시작: 결제 1회 시도 번호(= PG 결제 ID) */
export async function preparePayment() {
  return handle(async () => {
    await me();
    return { paymentNo: newPaymentNo() };
  });
}

/** C-PAY-010 결제창 결과 확인 (PG 서버 재조회 + 금액 비교) */
export async function completePayment(orderNo: string, paymentId: string) {
  return handle(async () => {
    const c = await me();
    if (c.demo || orderNo === DEMO_ORDER_NO) return { ok: !paymentId.endsWith('-FAIL'), failReason: paymentId.endsWith('-FAIL') ? '모의 결제 실패(테스트)' : null };
    return confirmPayment(c.id, parse(z.string().max(20), orderNo), parse(z.string().max(100), paymentId));
  });
}

/** C-PAY-010 현장 결제로 변경 */
export async function payOnsite(orderNo: string) {
  return handle(async () => {
    const c = await me();
    if (!c.demo) await switchToOnsite(c.id, parse(z.string().max(20), orderNo));
  });
}
