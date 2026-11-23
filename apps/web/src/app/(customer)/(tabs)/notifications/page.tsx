// C-NTF-010 알림함 · F-CUS-NTF-01: 받은 알림 목록, 딥링크(관련 예약 → C-ORD-020)
import { Alert, Empty, Tag } from '@aircon/ui';
import Link from 'next/link';
import { formatDateTime } from '@/customer/format';
import { loadCodes } from '@/server/codes';
import { requireCustomer } from '@/server/customer-session';
import { listCustomerNotifications } from '@/server/orders';

export const metadata = { title: '알림함' };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const me = await requireCustomer('/notifications');
  const [rows, codes] = await Promise.all([me.demo ? Promise.resolve([]) : listCustomerNotifications(me.id), loadCodes(['NOTIFICATION_CHANNEL'])]);
  const channel = (v: string) => codes.NOTIFICATION_CHANNEL?.find((c) => c.value === v)?.label ?? v;
  return (
    <main className="cus-page-body">
      <h1 className="ac-h2">알림함</h1>
      {me.demo ? <Alert tone="warning">체험 모드라 알림이 저장되지 않아요.</Alert> : null}
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <ul className="ac-list ac-card">
          {rows.map((n) => {
            const body = (
              <div className="ac-list-item__body">
                <span className="ac-body">{n.title ?? '알림'}</span>
                <div className="ac-caption ac-num">
                  {formatDateTime(n.sentAt ?? n.createdAt)} · {channel(n.channel)}
                  {n.orderNo ? ` · ${n.orderNo}` : ''}
                </div>
              </div>
            );
            return (
              <li key={n.id} className="ac-list-item">
                {n.orderNo ? (
                  <Link href={`/orders/${n.orderNo}`} style={{ color: 'inherit', textDecoration: 'none', flex: 1 }}>
                    {body}
                  </Link>
                ) : (
                  body
                )}
                {n.status === 'FAILED' ? <Tag tone="danger">발송 실패</Tag> : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
