// C-ORD-010 예약 목록 · F-CUS-ORD-01: 상태 탭 [진행중 | 완료 | 취소], 예약 카드(상태 배지 좌상단)
import { ACTIVE_ORDER_STATUSES } from '@aircon/domain';
import { Alert, Empty, StatusBadge } from '@aircon/ui';
import Link from 'next/link';
import { formatVisit, formatWon } from '@/customer/format';
import { requireCustomer } from '@/server/customer-session';
import { listCustomerOrders } from '@/server/orders';

export const metadata = { title: '내 예약' };
export const dynamic = 'force-dynamic';

const TABS = [
  { value: 'active', label: '진행중' },
  { value: 'done', label: '완료' },
  { value: 'canceled', label: '취소' },
] as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requireCustomer('/orders');
  const requested = (await searchParams).tab;
  const tab = TABS.find((t) => t.value === requested)?.value ?? 'active';
  const all = me.demo ? [] : await listCustomerOrders(me.id);
  const rows = all.filter((o) =>
    tab === 'active'
      ? (ACTIVE_ORDER_STATUSES as readonly string[]).includes(o.status)
      : tab === 'canceled'
        ? o.status === 'CANCELED'
        : !(ACTIVE_ORDER_STATUSES as readonly string[]).includes(o.status) && o.status !== 'CANCELED',
  );
  return (
    <main className="cus-page-body">
      <h1 className="ac-h2">내 예약</h1>
      <div className="ac-tabs" role="tablist">
        {TABS.map((t) => (
          <Link key={t.value} href={`/orders?tab=${t.value}`} role="tab" className="ac-tab" aria-selected={t.value === tab}>
            {t.label}
          </Link>
        ))}
      </div>
      {me.demo ? <Alert tone="warning">체험 모드라 예약이 저장되지 않아 목록이 비어 있어요.</Alert> : null}
      {rows.length === 0 ? (
        <Empty />
      ) : (
        rows.map((o) => (
          <Link key={o.id} href={`/orders/${o.orderNo}`} className="ac-card cus-order-card">
            <div className="cus-order-card__head">
              <StatusBadge code={o.status} audience="customer" />
              <span className="ac-caption ac-num">{o.orderNo}</span>
            </div>
            <strong className="ac-body ac-num">{o.promisedAt ? formatVisit(o.promisedAt) : '일정 협의 중'}</strong>
            <span className="ac-body-sm">{o.roadAddress}</span>
            <span className="ac-body-sm ac-num">{formatWon(o.totalAmount)}</span>
          </Link>
        ))
      )}
    </main>
  );
}
