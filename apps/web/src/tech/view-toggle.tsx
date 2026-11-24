// T-JOB-010 ⇄ T-MAP-010 상단 토글 [목록 | 지도] (03 §3.1) + 날짜 칩
import { kstDate } from '@aircon/domain';
import Link from 'next/link';
import { formatDateLabel } from '@/customer/format';

const addDays = (ymd: string, n: number) =>
  new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

export function JobViewToggle({ view, date }: { view: 'list' | 'map'; date?: string }) {
  const q = date ? `?date=${date}` : '';
  return (
    <nav className="ac-chip-row" aria-label="보기 방식">
      <Link
        href={`/tech/jobs${date ? `?tab=TODAY&date=${date}` : ''}`}
        className={`ac-chip${view === 'list' ? ' ac-chip--active' : ''}`}
        aria-current={view === 'list' ? 'page' : undefined}
      >
        목록
      </Link>
      <Link
        href={`/tech/map${q}`}
        className={`ac-chip${view === 'map' ? ' ac-chip--active' : ''}`}
        aria-current={view === 'map' ? 'page' : undefined}
      >
        지도
      </Link>
    </nav>
  );
}

/** 오늘~+6일 날짜 칩 */
export function DateChips({ base, date, days = 7 }: { base: string; date: string; days?: number }) {
  const today = kstDate(new Date());
  return (
    <nav className="ac-chip-row tec-date-chips" aria-label="날짜">
      {Array.from({ length: days }, (_, i) => addDays(today, i)).map((d) => (
        <Link
          key={d}
          href={`${base}?date=${d}`}
          className={`ac-chip${d === date ? ' ac-chip--active' : ''}`}
          aria-current={d === date ? 'date' : undefined}
        >
          {d === today ? '오늘' : formatDateLabel(d)}
        </Link>
      ))}
    </nav>
  );
}
