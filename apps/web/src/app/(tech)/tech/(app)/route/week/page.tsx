// T-RTE-030 주간 일정 · F-TEC-RTE-05: 7일 × 시간 칸(작업·빈 시간·휴무·근무 시간 밖). 빈 칸이 많은 날에 미배정 작업을 받도록 안내
// 시간 범위는 system_setting WEEK_GRID_START_HOUR·WEEK_GRID_END_HOUR, 근무 시간은 work_schedule(없으면 근무 시간 밖)
import { addDaysStr, kstDate, weekStartOf } from '@aircon/domain';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { loadCodes } from '@/server/codes';
import { techWeek } from '@/server/tech-support';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';

export const metadata = { title: '주간 일정' };
export const dynamic = 'force-dynamic';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const STATE_LABEL = { JOB: '작업', FREE: '빈 시간', OFF: '휴무', OUT: '근무 외' } as const;

export default async function TechWeekPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const me = await requireTech();
  const sp = await searchParams;
  const start = weekStartOf(/^\d{4}-\d{2}-\d{2}$/.test(sp.start ?? '') ? sp.start! : kstDate(new Date()));
  const [days, codes] = await Promise.all([techWeek(me.id, start), loadCodes(['SCHEDULE_TYPE'])]);
  const label = (v: string | null) => (v ? (codes.SCHEDULE_TYPE?.find((c) => c.value === v)?.label ?? v) : '');
  const hours = days[0]?.cells.map((c) => c.hour) ?? [];
  const free = days.reduce((s, d) => s + d.freeHours, 0);
  return (
    <main className="tec-page__body">
      <TechTopbar title="주간 일정" back={{ href: '/tech/route', label: '코스 편집으로' }} />
      <div className="tec-head-row">
        <Link href={`/tech/route/week?start=${addDaysStr(start, -7)}`} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="지난주">
          <ChevronLeft aria-hidden />
        </Link>
        <h2 className="ac-h3 ac-num">
          {start.slice(5).replace('-', '/')} ~ {addDaysStr(start, 6).slice(5).replace('-', '/')}
        </h2>
        <Link href={`/tech/route/week?start=${addDaysStr(start, 7)}`} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="다음 주">
          <ChevronRight aria-hidden />
        </Link>
      </div>
      <p className="ac-body">
        이번 주 빈 시간 <strong className="ac-num">{free}</strong>시간 ·{' '}
        <Link href="/tech/route/unassigned">관할 내 미배정 작업 보기</Link>
      </p>
      <div className="tec-week-wrap">
        <table className="tec-week" aria-label="주간 시간표">
          <thead>
            <tr>
              <th scope="col">
                <span className="ac-sr-only">시간</span>
              </th>
              {days.map((d) => (
                <th key={d.date} scope="col">
                  <Link href={`/tech/route?date=${d.date}`}>
                    {WEEK[dow(d.date)]}
                    <br />
                    <span className="ac-num">{Number(d.date.slice(8))}</span>
                  </Link>
                  {d.dayOff ? <span className="tec-week__off">{label(d.scheduleType)}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((h, i) => (
              <tr key={h}>
                <th scope="row" className="ac-num">
                  {String(h).padStart(2, '0')}
                </th>
                {days.map((d) => {
                  const c = d.cells[i]!;
                  return (
                    <td key={d.date} className={`tec-week__cell is-${c.state.toLowerCase()}`} title={c.jobs.join(', ') || STATE_LABEL[c.state]}>
                      <span className="ac-sr-only">{STATE_LABEL[c.state]}</span>
                      {c.state === 'JOB' ? <span aria-hidden className="ac-num">{c.jobs.length}</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="tec-week-legend" aria-label="범례">
        {(['JOB', 'FREE', 'OFF', 'OUT'] as const).map((s) => (
          <li key={s}>
            <span className={`tec-week__cell is-${s.toLowerCase()}`} aria-hidden />
            {STATE_LABEL[s]}
          </li>
        ))}
      </ul>
      <table className="ac-table">
        <thead>
          <tr>
            <th scope="col">날짜</th>
            <th scope="col" className="is-num">
              작업
            </th>
            <th scope="col" className="is-num">
              빈 시간
            </th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td className="ac-num">
                {d.date.slice(5).replace('-', '/')}({WEEK[dow(d.date)]}) {d.dayOff ? label(d.scheduleType) : ''}
              </td>
              <td className="is-num ac-num">{d.jobCount}건</td>
              <td className="is-num ac-num">{d.freeHours}시간</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
