// T-CAL-010 캘린더 (근무 모드 ⇄ 메모 모드) · F-TEC-CAL-01 · F-TEC-CAL-02
// - 근무: 날짜 칸에 지난 날 "접수/미처리", 오늘·앞날 "남은/미처리". BR-032 장기 미처리는 빨간 점. 휴무·연차·교육은 근무 일정 표시
// - 메모: 날짜 칸에 메모 건수(반복 포함). 날짜를 누르면 아래에 그날 작업·메모 목록, [메모 등록]
import { isMonthStr, kstDate, shiftMonth, showsScheduleLabel } from '@aircon/domain';
import { Card, Empty, StatusBadge, Tag } from '@aircon/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { loadCodes } from '@/server/codes';
import { techCalendar, techCalendarDay } from '@/server/tech-support';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';
import { formatDateLabel } from '@/customer/format';

export const metadata = { title: '캘린더' };
export const dynamic = 'force-dynamic';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export default async function TechCalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; date?: string; mode?: string }> }) {
  const me = await requireTech();
  const sp = await searchParams;
  const now = new Date();
  const today = kstDate(now);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : today;
  const month = isMonthStr(sp.month) ? sp.month : date.slice(0, 7);
  const mode = sp.mode === 'memo' ? 'memo' : 'work';
  const [cal, day, codes] = await Promise.all([techCalendar(me, month, now), techCalendarDay(me, date, now), loadCodes(['SCHEDULE_TYPE', 'MEMO_HEADER', 'MEMO_PRIORITY_SOURCE'])]);
  const label = (g: string, v: string | null) => (v ? (codes[g]?.find((c) => c.value === v)?.label ?? v) : '');
  const q = (o: { month?: string; date?: string; mode?: string }) => {
    const p = new URLSearchParams({ month: o.month ?? month, date: o.date ?? date, mode: o.mode ?? mode });
    return `/tech/calendar?${p.toString()}`;
  };
  const [y, m] = month.split('-').map(Number);
  return (
    <main className="tec-page__body">
      <TechTopbar title="캘린더" />
      <div className="tec-head-row">
        <div className="ac-segmented" role="group" aria-label="보기 모드">
          <Link href={q({ mode: 'work' })} aria-current={mode === 'work' ? 'page' : undefined} className={`tec-seg${mode === 'work' ? ' is-active' : ''}`}>
            근무
          </Link>
          <Link href={q({ mode: 'memo' })} aria-current={mode === 'memo' ? 'page' : undefined} className={`tec-seg${mode === 'memo' ? ' is-active' : ''}`}>
            메모
          </Link>
        </div>
        <Link href="/tech/route/week" className="ac-btn ac-btn--text ac-btn--sm">
          주간 일정
        </Link>
      </div>
      <div className="tec-head-row">
        <Link href={q({ month: shiftMonth(month, -1), date: `${shiftMonth(month, -1)}-01` })} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="이전 달">
          <ChevronLeft aria-hidden />
        </Link>
        <h2 className="ac-h3 ac-num">
          {y}년 {m}월
        </h2>
        <Link href={q({ month: shiftMonth(month, 1), date: `${shiftMonth(month, 1)}-01` })} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="다음 달">
          <ChevronRight aria-hidden />
        </Link>
      </div>
      <table className="tec-cal" aria-label={`${y}년 ${m}월 ${mode === 'work' ? '근무' : '메모'} 달력`}>
        <thead>
          <tr>
            {WEEK.map((w) => (
              <th key={w} scope="col">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cal.weeks.map((week, i) => (
            <tr key={i}>
              {week.map((d, k) => {
                if (!d) return <td key={k} />;
                const info = cal.days[d]!;
                const w = info.work;
                return (
                  <td key={d}>
                    <Link
                      href={q({ date: d })}
                      className={`tec-cal__day${d === date ? ' is-selected' : ''}${d === cal.today ? ' is-today' : ''}`}
                      aria-current={d === date ? 'date' : undefined}
                      aria-label={formatDateLabel(d)}
                    >
                      <span className="tec-cal__num ac-num">{Number(d.slice(8))}</span>
                      {mode === 'work' ? (
                        <>
                          {showsScheduleLabel(info.scheduleType) ? <span className="tec-cal__off">{label('SCHEDULE_TYPE', info.scheduleType)}</span> : null}
                          {w.total ? (
                            <span className="tec-cal__count ac-num">
                              {w.mode === 'PAST' ? w.total : w.remaining}/{w.pending}
                            </span>
                          ) : null}
                          {w.longPending ? <span className="tec-cal__dot" role="img" aria-label="장기 미처리" /> : null}
                        </>
                      ) : info.memoCount ? (
                        <span className="tec-cal__count ac-num">메모 {info.memoCount}</span>
                      ) : null}
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ac-caption">{mode === 'work' ? '숫자: 지난 날 접수/미처리, 오늘·앞날 남은/미처리 · 빨간 점: 장기 미처리' : '숫자: 그날 메모 건수(반복 포함)'}</p>
      <section className="tec-section" aria-labelledby="day-title">
        <div className="tec-head-row">
          <h2 id="day-title" className="ac-h3">
            {formatDateLabel(date)}
            {day.schedule && showsScheduleLabel(day.schedule.scheduleType) ? <> · {label('SCHEDULE_TYPE', day.schedule.scheduleType)}</> : null}
          </h2>
          <Link href={`/tech/memos/new?date=${date}`} className="ac-btn ac-btn--outline ac-btn--sm">
            메모 등록
          </Link>
        </div>
        {mode === 'work' ? (
          day.jobs.length ? (
            <ul className="tec-job-list">
              {day.jobs.map((j) => (
                <li key={j.orderNo}>
                  <Link href={`/tech/jobs/${j.orderNo}`} className="tec-job-card">
                    <div className="tec-job-card__top">
                      <StatusBadge code={j.status} audience="staff" overdue48h={j.longPending} />
                      {j.longPending ? <Tag tone="danger">장기 미처리</Tag> : null}
                      <span className="ac-body ac-num">{j.orderNo}</span>
                      <span className="tec-job-card__time ac-num">
                        {j.start}~{j.end}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>조회 결과가 없습니다.</Empty>
          )
        ) : day.memos.length ? (
          <ul className="tec-job-list">
            {day.memos.map((mm) => (
              <li key={mm.id}>
                <Card>
                  <div className="tec-job-card__top">
                    <Tag tone={mm.prioritySource === 'BRANCH_MANAGER' ? 'danger' : mm.prioritySource === 'ADMIN' ? 'primary' : undefined}>{label('MEMO_PRIORITY_SOURCE', mm.prioritySource)}</Tag>
                    {mm.headerCode ? <span className="ac-body-sm">[{label('MEMO_HEADER', mm.headerCode)}]</span> : null}
                    {mm.mine ? (mm.isDone ? <Tag tone="success">완료</Tag> : null) : mm.readAt ? <Tag tone="success">확인함</Tag> : <Tag tone="warning">미확인</Tag>}
                    {mm.mine ? (
                      <Link href={`/tech/memos/${mm.id}`} className="ac-btn ac-btn--text ac-btn--sm tec-job-card__time">
                        수정
                      </Link>
                    ) : (
                      <span className="ac-caption tec-job-card__time">{mm.authorName}</span>
                    )}
                  </div>
                  <p className="ac-body tec-note">{mm.content}</p>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>조회 결과가 없습니다.</Empty>
        )}
      </section>
    </main>
  );
}
