// T-JOB-010 작업 목록 · F-TEC-JOB-01: 탭 [오늘 | 예정 | 미처리 | 완료], 날짜 선택, 처리완료는 하단·배경색
import { Empty } from '@aircon/ui';
import { TECH_JOB_TABS, type TechJobTab, kstDate } from '@aircon/domain';
import Link from 'next/link';
import { TechJobCard } from '@/tech/job-card';
import { TechTopbar } from '@/tech/topbar';
import { listTechJobs } from '@/server/tech-jobs';
import { requireTech } from '@/server/tech-session';

export const metadata = { title: '작업 목록' };

const LABEL: Record<TechJobTab, string> = { TODAY: '오늘', UPCOMING: '예정', PENDING: '미처리', DONE: '완료' };

export default async function TechJobsPage({ searchParams }: { searchParams: Promise<{ tab?: string; date?: string }> }) {
  const me = await requireTech();
  const sp = await searchParams;
  const tab = (TECH_JOB_TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as TechJobTab) : 'TODAY';
  const today = kstDate(new Date());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : today;
  const all = await listTechJobs(me.id);
  // "오늘" 탭은 선택한 날짜의 작업 전부(처리완료 포함, 하단), 나머지는 탭 기준
  const jobs = tab === 'TODAY' ? all.filter((j) => j.date === date && j.tab !== 'PENDING') : all.filter((j) => j.tab === tab);
  return (
    <main className="tec-page__body">
      <TechTopbar title="작업" />
      <div className="ac-tabs tec-tabs" role="tablist" aria-label="작업 구분">
        {TECH_JOB_TABS.map((t) => (
          <Link key={t} href={`/tech/jobs?tab=${t}`} role="tab" className="ac-tab" aria-selected={t === tab}>
            {LABEL[t]} <span className="ac-num">{t === 'TODAY' ? all.filter((j) => j.date === today && j.tab !== 'PENDING').length : all.filter((j) => j.tab === t).length}</span>
          </Link>
        ))}
      </div>
      {tab === 'TODAY' ? (
        <form className="tec-date-row" action="/tech/jobs">
          <input type="hidden" name="tab" value="TODAY" />
          <label className="ac-sr-only" htmlFor="job-date">
            날짜
          </label>
          <input id="job-date" className="ac-input" type="date" name="date" defaultValue={date} />
          <button type="submit" className="ac-btn ac-btn--outline">
            보기
          </button>
        </form>
      ) : null}
      {jobs.length ? (
        <ul className="tec-job-list">
          {jobs.map((j) => (
            <li key={j.orderNo}>
              <TechJobCard job={j} showDate={tab !== 'TODAY'} />
            </li>
          ))}
        </ul>
      ) : (
        <Empty />
      )}
    </main>
  );
}
