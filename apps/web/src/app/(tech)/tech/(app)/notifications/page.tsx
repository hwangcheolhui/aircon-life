// T-NTF-010 알림 · F-TEC-NTF-01: 신규 배정·배정 변경·이관 반려 (독촉·전달·추가요금 동의 결과·공지는 해당 단계에서 추가)
import { Empty } from '@aircon/ui';
import Link from 'next/link';
import { formatDateTime } from '@/customer/format';
import { listTechNotifications } from '@/server/tech-jobs';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';

export const metadata = { title: '알림' };

export default async function TechNotificationsPage() {
  const me = await requireTech();
  const rows = await listTechNotifications(me.id);
  return (
    <main className="tec-page__body">
      <TechTopbar title="알림" back={{ href: '/tech', label: '홈' }} />
      {rows.length ? (
        <ul className="ac-list">
          {rows.map((n) => (
            <li key={n.id} className="ac-list-item">
              <div className="ac-list-item__body">
                <span className="ac-body">{n.title ?? '알림'}</span>
                <span className="ac-caption ac-num"> · {formatDateTime(n.createdAt)}</span>
                {n.orderNo ? (
                  <div>
                    <Link href={`/tech/jobs/${n.orderNo}`} className="ac-btn ac-btn--text ac-btn--sm ac-num">
                      {n.orderNo} 작업 보기
                    </Link>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>받은 알림이 없습니다.</Empty>
      )}
    </main>
  );
}
