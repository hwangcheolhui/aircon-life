// T-HOM-010 기사 홈 (단계 4-1 기본: 주요 공지 · 오늘의 약속) · F-TEC-HOM-01·02
// 공지(notice)는 단계 8, 메모·자재·주간 할일·퀵메뉴는 단계 10, 근무 시작 토글은 단계 4-2에서 붙는다.
import { Card, Empty } from '@aircon/ui';
import Link from 'next/link';
import { TechJobCard } from '@/tech/job-card';
import { TechTopbar } from '@/tech/topbar';
import { todayAppointments } from '@/server/tech-jobs';
import { requireTech } from '@/server/tech-session';

export const metadata = { title: '홈' };

export default async function TechHomePage() {
  const me = await requireTech();
  const today = await todayAppointments(me.id);
  return (
    <main className="tec-page__body">
      <TechTopbar title={`${me.name} 기사님`} />
      <section className="tec-section" aria-labelledby="notice-title">
        <h2 id="notice-title" className="ac-h3">
          주요 공지
        </h2>
        <Card>
          <Empty>등록된 공지가 없습니다.</Empty>
        </Card>
      </section>
      <section className="tec-section" aria-labelledby="today-title">
        <div className="tec-head-row">
          <h2 id="today-title" className="ac-h3">
            오늘의 약속{' '}
            <span className="ac-num">
              {today.remaining}/{today.total}
            </span>
          </h2>
          <Link href="/tech/jobs" className="ac-btn ac-btn--text ac-btn--sm">
            더보기
          </Link>
        </div>
        {today.jobs.length ? (
          <ul className="tec-job-list">
            {today.jobs.map((j) => (
              <li key={j.orderNo}>
                <TechJobCard job={j} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>오늘 약속이 없습니다.</Empty>
        )}
      </section>
    </main>
  );
}
