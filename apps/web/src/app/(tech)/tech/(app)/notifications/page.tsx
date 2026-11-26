// T-NTF-010 알림 · F-TEC-NTF-01: 신규 배정·배정 변경·이관 반려 · 단계 8: 독촉·전달(T-NTF-020, F-TEC-NTF-02) 목록을 위에 따로 보인다
import { Empty, Tag } from '@aircon/ui';
import { listTechFollowups } from '@/server/followups';
import Link from 'next/link';
import { formatDateTime } from '@/customer/format';
import { listTechNotifications } from '@/server/tech-jobs';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';

export const metadata = { title: '알림' };

export default async function TechNotificationsPage() {
  const me = await requireTech();
  const [rows, followups] = await Promise.all([listTechNotifications(me.id), listTechFollowups(me.id)]);
  return (
    <main className="tec-page__body">
      <TechTopbar title="알림" back={{ href: '/tech', label: '홈' }} />
      {followups.length ? (
        <section className="tec-section" aria-labelledby="followup-title">
          <h2 id="followup-title" className="ac-h3">
            독촉·전달
          </h2>
          <ul className="ac-list">
            {followups.map((f) => (
              <li key={f.id} className="ac-list-item">
                <Link href={`/tech/notifications/followups/${f.id}`} className="ac-list-item__body">
                  {f.status === 'SENT' ? <Tag tone="danger">새 전달</Tag> : f.status === 'READ' ? <Tag tone="warning">회신 필요</Tag> : <Tag>회신함</Tag>}{' '}
                  <span className="ac-body">{f.message}</span>
                  <span className="ac-caption ac-num">
                    {' '}
                    · {f.followupCount}차{f.orderNo ? ` · ${f.orderNo}` : ''} · {formatDateTime(f.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
