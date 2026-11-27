/**
 * 기사 캘린더·주간 일정 규칙 (단계 10, F-TEC-CAL-01·02 · F-TEC-RTE-05).
 * - 월 달력(일요일 시작) 칸 만들기
 * - 근무 모드 날짜 요약: 지난 날은 "접수 n / 미처리 m", 오늘·앞날은 "남은 n / 미처리 m", 장기 미처리(BR-032)가 있으면 강조
 * - 주간 일정: 7일 × 1시간 칸에 작업·빈 시간·휴무·근무 시간 밖을 나눈다(근무 시간은 근무표, 비면 WORK_DEFAULT_START/END, 반차는 가운데 시각으로 나눔 = slot.hoursOf)
 */
import { hoursOf, type ScheduleLike } from '../slot/slot';
import { isTechJobDone } from '../tech/tech-rules';
import { addDaysStr } from './memo-rules';

/** 근무하지 않는 날(휴무·연차·교육). 반차는 근무일 */
export const DAY_OFF_TYPES = ['OFF', 'ANNUAL', 'TRAINING'] as const;
export const isDayOffType = (t: string | null | undefined) => !!t && (DAY_OFF_TYPES as readonly string[]).includes(t);
/** 달력에 근무 유형 이름을 붙이는 날(일반 근무는 표시하지 않음) */
export const showsScheduleLabel = (t: string | null | undefined) => !!t && t !== 'WORK';

/** 'YYYY-MM' 이 올바른 달인지 */
export const isMonthStr = (s: string | undefined | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** 월 달력 칸: 일요일 시작, 주 단위 7칸, 그 달이 아닌 칸은 null */
export function monthGrid(month: string): (string | null)[][] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 이전·다음 달 */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export interface CalendarJob {
  date: string | null;
  status: string;
  /** BR-032 장기 미처리 여부(서버가 isLongPending 으로 계산) */
  longPending: boolean;
}

export interface WorkDaySummary {
  /** 취소를 뺀 그날 약속 건수(접수건) */
  total: number;
  pending: number;
  /** 아직 끝나지 않은 작업(미처리 제외) */
  remaining: number;
  longPending: boolean;
  /** 지난 날 = 접수/미처리, 오늘·앞날 = 남은/미처리 */
  mode: 'PAST' | 'UPCOMING';
}

/** 근무 모드 날짜 요약 (F-TEC-CAL-01) */
export function workDaySummary(date: string, today: string, jobs: readonly CalendarJob[]): WorkDaySummary {
  const day = jobs.filter((j) => j.date === date && j.status !== 'CANCELED');
  const pending = day.filter((j) => j.status === 'PENDING');
  return {
    total: day.length,
    pending: pending.length,
    remaining: day.filter((j) => j.status !== 'PENDING' && !isTechJobDone(j.status)).length,
    longPending: pending.some((j) => j.longPending),
    mode: date < today ? 'PAST' : 'UPCOMING',
  };
}

/* ---------- 주간 일정 (F-TEC-RTE-05, T-RTE-030) ---------- */

export type WeekCellState = 'JOB' | 'FREE' | 'OFF' | 'OUT';

export interface WeekJob {
  date: string;
  /** 시작·끝 HH:MM (한국 시각) */
  start: string;
  end: string;
  orderNo: string;
  status: string;
}

export interface WeekDay {
  date: string;
  scheduleType: string | null;
  dayOff: boolean;
  cells: { hour: number; state: WeekCellState; jobs: string[] }[];
  jobCount: number;
  freeHours: number;
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h! * 60 + (m ?? 0);
};

/**
 * 7일 × 시간 칸. 작업이 한 시간 칸에 조금이라도 걸치면 그 칸은 작업(JOB).
 * 근무표가 없는 날은 근무 시간 밖(OUT)으로 보고, 그래도 작업이 있으면 그 칸만 작업으로 표시한다.
 */
export function weekGrid(i: {
  startDate: string;
  fromHour: number;
  toHour: number;
  schedules: readonly Pick<ScheduleLike, 'workDate' | 'scheduleType' | 'startTime' | 'endTime'>[];
  jobs: readonly WeekJob[];
  defaults: { defaultStart: string; defaultEnd: string };
}): WeekDay[] {
  return Array.from({ length: 7 }, (_, k) => {
    const date = addDaysStr(i.startDate, k);
    const s = i.schedules.find((x) => x.workDate === date) ?? null;
    const dayOff = isDayOffType(s?.scheduleType);
    const workHours = s && !dayOff ? hoursOf({ technicianId: 0, ...s }, i.defaults) : [];
    const dayJobs = i.jobs.filter((j) => j.date === date && j.status !== 'CANCELED');
    const cells = [];
    for (let h = i.fromHour; h < i.toHour; h++) {
      const jobs = dayJobs.filter((j) => toMin(j.start) < (h + 1) * 60 && toMin(j.end) > h * 60).map((j) => j.orderNo);
      const state: WeekCellState = jobs.length ? 'JOB' : dayOff ? 'OFF' : workHours.includes(h) ? 'FREE' : 'OUT';
      cells.push({ hour: h, state, jobs });
    }
    return { date, scheduleType: s?.scheduleType ?? null, dayOff, cells, jobCount: dayJobs.length, freeHours: cells.filter((c) => c.state === 'FREE').length };
  });
}

/** 주간 일정 첫날: 기준일이 속한 주의 월요일 */
export function weekStartOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일
  return addDaysStr(date, dow === 0 ? -6 : 1 - dow);
}
