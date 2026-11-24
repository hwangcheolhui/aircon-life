// C-PAY-020 작업 후 결제 · F-CUS-PAY-02: 작업 완료 후 남은 금액(현장 추가요금 포함)을 PG로 결제 → 서버 재확인 → 주문 완료.
// 기사의 앱 결제 요청(알림톡)·결제 링크 문자로 들어온다. 금액은 .ac-bottom-bar 에 표시.
import { createPaymentGateway } from '@aircon/integrations';
import { notFound } from 'next/navigation';
import { loadCodes } from '@/server/codes';
import { requireCustomer } from '@/server/customer-session';
import { getCustomerPayment } from '@/server/payments';
import { PostPay } from '@/customer/post-pay';

export const metadata = { title: '작업 후 결제' };
export const dynamic = 'force-dynamic';

export default async function PostPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNo: string }>;
  searchParams: Promise<{ paymentId?: string }>;
}) {
  const { orderNo } = await params;
  const sp = await searchParams;
  const me = await requireCustomer(`/orders/${orderNo}/pay`);
  const s = me.demo ? null : await getCustomerPayment(me.id, orderNo);
  if (!s) notFound();
  const gateway = createPaymentGateway();
  const codes = await loadCodes(['PAYMENT_METHOD', 'TAX_DOC_TYPE', 'TAX_ISSUE_STATUS']);
  return (
    <PostPay
      s={s}
      codes={codes}
      driver={gateway.kind}
      portone={
        gateway.kind === 'portone'
          ? { storeId: process.env.PORTONE_STORE_ID ?? '', channelKey: process.env.PORTONE_CHANNEL_KEY ?? '' }
          : null
      }
      returnedPaymentId={sp.paymentId ?? null}
    />
  );
}
