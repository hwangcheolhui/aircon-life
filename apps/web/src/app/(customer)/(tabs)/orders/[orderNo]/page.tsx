// C-ORD-020 예약 상세 · F-CUS-ORD-02: 상태 타임라인, 단계 5-2: 추가요금 동의 요청 안내(C-ORD-040)·동의된 추가요금 금액, 방문 예정 시간(단계 4-2: 기사 코스 확정 시각, 단계 5-1: 이동 중이면 도착 예정시각 — 좌표는 보여 주지 않음 BR-115), 작업 리포트 링크(C-ORD-050), 단계 8: [AS 요청](C-AS-010), 단계 9: [후기 쓰기](C-REV-010)·[기사님께 전화(안심번호)], 단계 6: 작업 후 결제(C-PAY-020)·증빙 신청(C-PAY-030), 기사 정보(배정 후, 단계 4-1: 고객 표시 이름·소개), 항목·금액, 액션(결제·변경·취소·고객센터)
import { canCustomerCancel, canSeeWorkReport } from '@aircon/domain';
import { Alert, Card, StatusBadge, Tag } from '@aircon/ui';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { SafeCallButton } from '@/shared/safe-call-button';
import { safeCallNumber } from '../actions';
import { notFound } from 'next/navigation';
import { formatClock, formatDateLabel, formatDateTime, formatVisit, formatVisitTime, formatWon } from '@/customer/format';
import { loadCodes } from '@/server/codes';
import { requireCustomer } from '@/server/customer-session';
import { customerExtraCharges } from '@/server/extra-charges';
import { getCustomerOrder } from '@/server/orders';
import { paymentsOf } from '@/server/payments';
import { customerVisitInfo } from '@/server/route-plans';
import { ReceiptRequest } from '@/customer/receipt-request';

/** 선결제(C-PAY-010)는 작업 전 주문만. 작업 후 금액은 C-PAY-020 */
const PREPAY_STATUSES = ['QUOTED', 'RECEIVED', 'ASSIGN_WAIT', 'ASSIGNED'];

export const metadata = { title: '예약 상세' };
export const dynamic = 'force-dynamic';

export default async function OrderDetailPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const me = await requireCustomer(`/orders/${orderNo}`);
  const o = me.demo ? null : await getCustomerOrder(me.id, orderNo);
  if (!o) notFound();
  const [codes, visit, extras] = await Promise.all([
    loadCodes(['PAYMENT_STATUS', 'CHANGE_REQUEST_STATUS', 'CHANGE_REQUEST_TYPE', 'PAYMENT_METHOD', 'TAX_DOC_TYPE', 'TAX_ISSUE_STATUS']),
    customerVisitInfo(o.id),
    customerExtraCharges(me.id, orderNo),
  ]);
  const payments = await paymentsOf(o.id);
  const waitingExtra = extras?.charges.filter((c) => c.state === 'WAIT_CUSTOMER') ?? [];
  const agreedExtra = extras?.charges.filter((c) => c.state === 'AGREED') ?? [];
  const added = new Set(extras?.addedItemIds ?? []);
  // 완료 전에는 동의된 추가요금을 더해 보여 준다(완료 때 주문 금액에 합쳐진다, BR-040)
  const total = o.status === 'WORK_DONE' || o.status === 'COMPLETED' ? o.totalAmount : o.totalAmount + (extras?.agreed ?? 0);
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
        {visit?.kind === 'ETA' ? (
          <p className="ac-body cus-visit-time">
            기사님이 출발했어요. 도착 예정 <strong className="ac-num">{formatClock(visit.at)}</strong> 전후
          </p>
        ) : visit ? (
          <p className="ac-body cus-visit-time">
            방문 예정 <strong className="ac-num">{formatVisitTime(visit.at)}</strong> 전후
          </p>
        ) : o.status === 'RECEIVED' || o.status === 'ASSIGN_WAIT' || o.status === 'ASSIGNED' ? (
          <p className="ac-caption">정확한 도착 시간은 기사님 일정이 확정되면 알려 드려요.</p>
        ) : null}
      </div>
      {waitingExtra.length && extras?.canRespond ? (
        <Alert tone="warning">
          기사님이 추가요금 동의를 요청했어요({waitingExtra.length}건).{' '}
          <Link href={`/orders/${o.orderNo}/extra`}>확인하기</Link>
        </Alert>
      ) : null}
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
          {o.tech ? (
            <dd>
              <strong>{o.tech.name} 기사님</strong>
              {o.tech.intro ? <p className="ac-caption cus-tech-intro">{o.tech.intro}</p> : null}
            </dd>
          ) : (
            <dd>배정되면 알려 드려요</dd>
          )}
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
        {o.items.filter((i) => !added.has(i.id)).map((i) => (
          <div key={i.id} className="cus-amount-row ac-body">
            <span>
              {i.name}
              {i.itemType === 'PRODUCT' || i.itemType === 'OPTION' ? <span className="ac-num"> × {i.quantity}</span> : null}
            </span>
            <span className="ac-num">{i.amount < 0 ? `−${formatWon(-i.amount)}` : formatWon(i.amount)}</span>
          </div>
        ))}
        {agreedExtra.map((c) => (
          <div key={`x${c.id}`} className="cus-amount-row ac-body">
            <span>현장 추가: {c.title}</span>
            <span className="ac-num">{formatWon(c.amount)}</span>
          </div>
        ))}
        <div className="cus-amount-row cus-amount-row--total ac-body-lg">
          <span>총 금액</span>
          <span className="ac-num">{formatWon(total)}</span>
        </div>
        <p className="ac-caption" style={{ marginBottom: 0 }}>
          결제 상태 <Tag>{label('PAYMENT_STATUS', o.paymentStatus)}</Tag>
        </p>
      </Card>
      {extras?.charges.length ? (
        <Link href={`/orders/${o.orderNo}/extra`} className="ac-btn ac-btn--ghost ac-btn--block">
          추가요금 내역 보기
        </Link>
      ) : null}
      {canSeeWorkReport(o.status) ? (
        <Link href={`/orders/${o.orderNo}/report`} className="ac-btn ac-btn--outline ac-btn--lg ac-btn--block">
          작업 리포트 보기 (전·후 사진)
        </Link>
      ) : null}
      {o.status === 'WORK_DONE' && o.totalAmount > o.paidAmount ? (
        <Link href={`/orders/${o.orderNo}/pay`} className="ac-btn ac-btn--primary ac-btn--lg ac-btn--block">
          작업 금액 결제하기
        </Link>
      ) : PREPAY_STATUSES.includes(o.status) && o.paymentStatus === 'UNPAID' ? (
        <Link href={`/reserve/pay/${o.orderNo}`} className="ac-btn ac-btn--primary ac-btn--lg ac-btn--block">
          지금 결제하기
        </Link>
      ) : null}
      <ReceiptRequest orderNo={o.orderNo} payments={payments} codes={codes} />
      {(o.status === 'COMPLETED' || o.status === 'WORK_DONE') && o.orderType !== 'AS' ? (
        <Link href={`/orders/${o.orderNo}/review`} className="ac-btn ac-btn--outline ac-btn--lg ac-btn--block">
          후기 쓰기
        </Link>
      ) : null}
      {o.tech && ['ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS'].includes(o.status) ? <SafeCallButton orderNo={o.orderNo} label="기사님께 전화 (안심번호)" action={safeCallNumber} /> : null}
      {(o.status === 'COMPLETED' || o.status === 'WORK_DONE') && o.orderType !== 'AS' ? (
        <Link href={`/orders/${o.orderNo}/as`} className="ac-btn ac-btn--outline ac-btn--lg ac-btn--block">
          AS 요청
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
