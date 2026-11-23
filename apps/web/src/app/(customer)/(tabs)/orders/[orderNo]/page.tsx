// C-ORD-020 예약 상세 · F-CUS-ORD-02: 상태 타임라인, 방문 예정 시간, 기사 정보(배정 후, 단계 3), 항목·금액, 액션(결제·변경·취소·고객센터)
import { canCustomerCancel } from '@aircon/domain';
import { Alert, Card, StatusBadge, Tag } from '@aircon/ui';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDateLabel, formatDateTime, formatVisit, formatWon } from '@/customer/format';
import { loadCodes } from '@/server/codes';
import { requireCustomer } from '@/server/customer-session';
import { getCustomerOrder } from '@/server/orders';

export const metadata = { title: '예약 상세' };
export const dynamic = 'force-dynamic';

export default async function OrderDetailPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const me = await requireCustomer(`/orders/${orderNo}`);
  const o = me.demo ? null : await getCustomerOrder(me.id, orderNo);
  if (!o) notFound();
  const codes = await loadCodes(['PAYMENT_STATUS', 'CHANGE_REQUEST_STATUS', 'CHANGE_REQUEST_TYPE']);
  const label = (g: string, v: string) => codes[g]?.find((c) => c.value === v)?.label ?? v;
  const openRequest = o.requests.find((r) => r.status === 'REQUESTED');
  return (
    <main className="cus-page-body">
      <div className="cus-topbar">
        <Link href="/orders" className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="내 예약 목록">
          <ChevronLeft aria-hidden />
        </Link>
        <span className="ac-caption ac-num">{o.orderNo}</span>
      </div>
      <div>
        <StatusBadge code={o.status} audience="customer" />
        <h1 className="ac-h2">{o.promisedAt ? formatVisit(o.promisedAt) : '일정 협의 중'}</h1>
        <p className="ac-caption">정확한 도착 시간은 기사님 일정이 확정되면 알려 드려요.</p>
      </div>
      {openRequest ? (
        <Alert>
          일정 변경 요청을 확인하고 있어요
          {openRequest.requestedDate ? ` (희망: ${formatDateLabel(openRequest.requestedDate)} ${openRequest.requestedTime?.slice(0, 5)})` : ''}.
        </Alert>
      ) : null}
      <Card>
        <h2 className="ac-h3" style={{ marginTop: 0 }}>
          진행 상황
        </h2>
        <ol className="ac-timeline">
          {o.history.map((h, i) => (
            <li key={h.id} className={i === o.history.length - 1 ? 'is-current' : 'is-done'}>
              <strong>
                <StatusBadge code={h.toStatus} audience="customer" />
              </strong>
              <span className="ac-caption ac-num">{formatDateTime(h.createdAt)}</span>
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <dl className="cus-kv ac-body">
          <dt>방문 주소</dt>
          <dd>
            {o.roadAddress} {o.detailAddress}
          </dd>
          <dt>담당 기사</dt>
          <dd>배정되면 알려 드려요</dd>
          {o.customerRequest ? (
            <>
              <dt>요청사항</dt>
              <dd>{o.customerRequest}</dd>
            </>
          ) : null}
        </dl>
      </Card>
      <Card>
        <h2 className="ac-h3" style={{ marginTop: 0 }}>
          금액
        </h2>
        {o.items.map((i) => (
          <div key={i.id} className="cus-amount-row ac-body">
            <span>
              {i.name}
              {i.itemType === 'PRODUCT' || i.itemType === 'OPTION' ? <span className="ac-num"> × {i.quantity}</span> : null}
            </span>
            <span className="ac-num">{i.amount < 0 ? `−${formatWon(-i.amount)}` : formatWon(i.amount)}</span>
          </div>
        ))}
        <div className="cus-amount-row cus-amount-row--total ac-body-lg">
          <span>총 금액</span>
          <span className="ac-num">{formatWon(o.totalAmount)}</span>
        </div>
        <p className="ac-caption" style={{ marginBottom: 0 }}>
          결제 상태 <Tag>{label('PAYMENT_STATUS', o.paymentStatus)}</Tag>
        </p>
      </Card>
      {o.status !== 'CANCELED' && o.paymentStatus === 'UNPAID' ? (
        <Link href={`/reserve/pay/${o.orderNo}`} className="ac-btn ac-btn--primary ac-btn--lg ac-btn--block">
          지금 결제하기
        </Link>
      ) : null}
      {canCustomerCancel(o.status) ? (
        <Link href={`/orders/${o.orderNo}/change`} className="ac-btn ac-btn--outline ac-btn--lg ac-btn--block">
          일정 변경·취소
        </Link>
      ) : null}
      {o.branchPhone ? (
        <a href={`tel:${o.branchPhone}`} className="ac-btn ac-btn--ghost ac-btn--block">
          고객센터 전화 <span className="ac-num">{o.branchPhone}</span>
        </a>
      ) : null}
      {o.requests.length ? (
        <Card>
          <h2 className="ac-h3" style={{ marginTop: 0 }}>
            변경·취소 요청
          </h2>
          <ul className="ac-list">
            {o.requests.map((r) => (
              <li key={r.id} className="ac-list-item">
                <div className="ac-list-item__body">
                  <span className="ac-body">{label('CHANGE_REQUEST_TYPE', r.requestType)}</span>
                  <span className="ac-caption ac-num"> · {formatDateTime(r.createdAt)}</span>
                </div>
                <Tag>{label('CHANGE_REQUEST_STATUS', r.status)}</Tag>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </main>
  );
}
