// C-PAY-010 결제 (S8) · F-CUS-PAY-01: 최종 금액, 결제수단(카드·간편결제는 PG 결제창), PG 호출 → 서버 재확인. 쿠폰(F-CUS-PAY-04)은 단계 9.
import { createPaymentGateway } from '@aircon/integrations';
import { notFound, redirect } from 'next/navigation';
import { requireCustomer } from '@/server/customer-session';
import { DEMO_ORDER_NO, getCustomerOrder } from '@/server/orders';
import { PayStep } from './pay-step';

export const metadata = { title: '결제' };
export const dynamic = 'force-dynamic';

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNo: string }>;
  searchParams: Promise<{ a?: string; paymentId?: string }>;
}) {
  const { orderNo } = await params;
  const sp = await searchParams;
  const me = await requireCustomer(`/reserve/pay/${orderNo}`);
  const gateway = createPaymentGateway();
  let amount: number;
  let items: { name: string; amount: number }[] = [];
  if (me.demo || orderNo === DEMO_ORDER_NO) {
    if (orderNo !== DEMO_ORDER_NO) notFound();
    amount = Number(sp.a ?? 0);
  } else {
    const o = await getCustomerOrder(me.id, orderNo);
    if (!o) notFound();
    if (o.paymentStatus !== 'UNPAID' || o.status === 'CANCELED') redirect(`/orders/${orderNo}`);
    amount = o.totalAmount;
    items = o.items.map((i) => ({ name: i.name, amount: i.amount }));
  }
  return (
    <PayStep
      orderNo={orderNo}
      amount={amount}
      items={items}
      driver={gateway.kind}
      portone={gateway.kind === 'portone' ? { storeId: process.env.PORTONE_STORE_ID ?? '', channelKey: process.env.PORTONE_CHANNEL_KEY ?? '' } : null}
      returnedPaymentId={sp.paymentId ?? null}
      demoQuery={me.demo ? `?a=${amount}` : ''}
    />
  );
}
