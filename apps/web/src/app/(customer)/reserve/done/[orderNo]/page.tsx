// C-RSV-040 예약 완료 (S9) · F-CUS-RSV-04: 접수번호, 일정, 다음 단계 안내 (접수 알림톡 발송은 확정·결제 시 서버가 처리)
import { Alert, Card, StatusBadge } from '@aircon/ui';
import { CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatVisit, formatWon } from '@/customer/format';
import { requireCustomer } from '@/server/customer-session';
import { DEMO_ORDER_NO, getCustomerOrder } from '@/server/orders';
import { ClearReserveDraft } from './clear-draft';

export const metadata = { title: '예약 완료' };
export const dynamic = 'force-dynamic';

export default async function DonePage({ params, searchParams }: { params: Promise<{ orderNo: string }>; searchParams: Promise<{ a?: string }> }) {
  const { orderNo } = await params;
  const me = await requireCustomer(`/reserve/done/${orderNo}`);
  const demo = me.demo || orderNo === DEMO_ORDER_NO;
  const o = demo ? null : await getCustomerOrder(me.id, orderNo);
  if (!demo && !o) notFound();
  const amount = o?.totalAmount ?? Number((await searchParams).a ?? 0);
  return (
    <main className="cus-flow__body">
      <ClearReserveDraft />
      <section className="cus-auth" style={{ alignItems: 'center', textAlign: 'center' }}>
        <CircleCheck aria-hidden width={48} height={48} />
        <h1 className="ac-h2">예약이 접수됐어요</h1>
        <p className="ac-body">예약 안내를 알림톡(또는 문자)으로 보내 드렸어요.</p>
      </section>
      {demo ? <Alert tone="warning">체험 모드라 예약이 저장되지 않았어요.</Alert> : null}
      <Card>
        <dl className="cus-kv ac-body">
          <dt>접수번호</dt>
          <dd className="ac-num">{o?.orderNo ?? '체험용(저장 안 됨)'}</dd>
          {o ? (
            <>
              <dt>상태</dt>
              <dd>
                <StatusBadge code={o.status} audience="customer" />
              </dd>
              <dt>방문 일시</dt>
              <dd className="ac-num">{o.promisedAt ? formatVisit(o.promisedAt) : ''}</dd>
              <dt>방문 주소</dt>
              <dd>
                {o.roadAddress} {o.detailAddress}
              </dd>
            </>
          ) : null}
          <dt>금액</dt>
          <dd className="ac-num">
            {formatWon(amount)}
            {o ? (o.paymentStatus === 'UNPAID' ? ' (현장 결제)' : ' (결제 완료)') : ''}
          </dd>
        </dl>
      </Card>
      <Card>
        <h2 className="ac-h3" style={{ marginTop: 0 }}>
          다음 단계
        </h2>
        <ol className="cus-plain-list ac-body-sm">
          <li>담당 기사님이 배정되면 알려 드려요.</li>
          <li>방문 전날 저녁에 방문 일정을 한 번 더 안내해 드려요.</li>
          <li>일정 변경·취소는 내 예약에서 할 수 있어요.</li>
        </ol>
      </Card>
      {o ? (
        <Link href={`/orders/${o.orderNo}`} className="ac-btn ac-btn--primary ac-btn--lg ac-btn--block">
          예약 상세 보기
        </Link>
      ) : null}
      <Link href="/" className="ac-btn ac-btn--ghost ac-btn--block">
        홈으로
      </Link>
    </main>
  );
}
