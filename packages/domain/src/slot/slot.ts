/**
 * 거점 운영 슬롯 (01 §2.8.1 time_slot): F-SYS-01 자동 생성, F-CUS-RSV-01 가용 시간, BR-021 잔여 수량.
 * - 슬롯은 1시간 단위(slot_hour = 시작 시각). 수용 건수 = 그 시간에 근무하는 기사 수 × 시간당 처리량(SLOT_JOBS_PER_TECH_HOUR).
 * - 예약은 시작 슬롯부터 필요한 슬롯 수만큼 연속으로 1건씩 차지한다(소요시간 2시간 이상이면 연속 슬롯, 02 F-CUS-RSV-01).
 * - 실제 차감은 DB에서 `booked_count < capacity` 조건부 UPDATE 로 한다(BR-021, 낙관적 잠금).
 */
import { kstDate } from '../quote/quote-status';

export type SlotKind = 'NORMAL' | 'CONTRACT' | 'URGENT' | 'ON_CALL';

export interface ScheduleLike {
  technicianId: number;
  workDate: string; // YYYY-MM-DD
  /** SCHEDULE_TYPE: WORK / OFF / HALF_AM / HALF_PM / ANNUAL / ON_CALL / TRAINING */
  scheduleType: string;
  startTime: string | null; // HH:MM(:SS)
  endTime: string | null;
}

export interface SlotDefaults {
  /** WORK_DEFAULT_START / WORK_DEFAULT_END: 근무 시간을 비워 둔 일정의 기본 시간 */
  defaultStart: string;
  defaultEnd: string;
  /** SLOT_JOBS_PER_TECH_HOUR: 기사 1명이 1시간에 받을 수 있는 건수 */
  jobsPerTechHour: number;
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h! * 60 + (m ?? 0);
};

/** 근무 유형 → 슬롯 구분 (휴무·연차·교육은 슬롯 없음) */
export function slotKindOf(scheduleType: string): SlotKind | null {
  if (scheduleType === 'WORK' || scheduleType === 'HALF_AM' || scheduleType === 'HALF_PM') return 'NORMAL';
  if (scheduleType === 'ON_CALL') return 'ON_CALL';
  return null;
}

/** 일정이 차지하는 1시간 슬롯 시작 시각 목록 (시작~종료 안에 1시간이 온전히 들어가는 시각만) */
export function hoursOf(s: ScheduleLike, d: Pick<SlotDefaults, 'defaultStart' | 'defaultEnd'>): number[] {
  if (!slotKindOf(s.scheduleType)) return [];
  let start = toMin(s.startTime ?? d.defaultStart);
  let end = toMin(s.endTime ?? d.defaultEnd);
  if (!s.startTime && !s.endTime && (s.scheduleType === 'HALF_AM' || s.scheduleType === 'HALF_PM')) {
    const mid = Math.floor((start + end) / 2 / 60) * 60;
    if (s.scheduleType === 'HALF_AM') start = mid; // 오전 반차 → 오후 근무
    else end = mid; // 오후 반차 → 오전 근무
  }
  const hours: number[] = [];
  for (let h = Math.ceil(start / 60); (h + 1) * 60 <= end; h++) hours.push(h);
  return hours;
}

export interface SlotPlanRow {
  branchId: number;
  slotDate: string;
  slotHour: number;
  slotKind: SlotKind;
  capacity: number;
}

/** F-SYS-01 근무표 → 날짜·시간대·구분별 수용 건수 */
export function buildSlotPlan(input: {
  branchId: number;
  dates: readonly string[];
  schedules: readonly ScheduleLike[];
} & SlotDefaults): SlotPlanRow[] {
  const counts = new Map<string, Set<number>>();
  const dates = new Set(input.dates);
  for (const s of input.schedules) {
    if (!dates.has(s.workDate)) continue;
    const kind = slotKindOf(s.scheduleType);
    if (!kind) continue;
    for (const h of hoursOf(s, input)) {
      const key = `${s.workDate}|${String(h).padStart(2, '0')}|${kind}`;
      if (!counts.has(key)) counts.set(key, new Set());
      counts.get(key)!.add(s.technicianId);
    }
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, techs]) => {
      const [slotDate, hour, kind] = key.split('|');
      return {
        branchId: input.branchId,
        slotDate: slotDate!,
        slotHour: Number(hour),
        slotKind: kind as SlotKind,
        capacity: techs.size * input.jobsPerTechHour,
      };
    });
}

/** 내일부터 days 일 (한국 날짜 YYYY-MM-DD) */
export function slotDates(today: string, days: number): string[] {
  const [y, m, d] = today.split('-').map(Number);
  return Array.from({ length: days }, (_, i) => new Date(Date.UTC(y!, m! - 1, d! + i + 1)).toISOString().slice(0, 10));
}

/** 오늘(한국 날짜) */
export const kstToday = (now: Date) => kstDate(now);

/* ---------- BR-021 가용 시간 ---------- */

/** 필요 슬롯 수: 2시간 미만은 1칸, 2시간 이상은 시간 올림만큼 연속 (02 F-CUS-RSV-01) */
export function slotsNeeded(durationMin: number): number {
  if (durationMin < 120) return 1;
  return Math.ceil(durationMin / 60);
}

export function slotHoursFor(startHour: number, durationMin: number): number[] {
  return Array.from({ length: slotsNeeded(durationMin) }, (_, i) => startHour + i);
}

export interface SlotAvailability {
  slotHour: number;
  capacity: number;
  bookedCount: number;
  isClosed: boolean;
}

/** BR-021 시작 가능한 시각: 시작부터 need 칸이 모두 있고, 마감이 아니며, 잔여 ≥ 필요 인원 */
export function availableStartHours(slots: readonly SlotAvailability[], need: number, units = 1): number[] {
  const free = new Map(slots.map((s) => [s.slotHour, !s.isClosed && s.capacity - s.bookedCount >= units]));
  return [...slots]
    .map((s) => s.slotHour)
    .sort((a, b) => a - b)
    .filter((h) => Array.from({ length: need }, (_, i) => free.get(h + i) === true).every(Boolean));
}

/** 방문 시각 문자열 HH:00 */
export const hourToTime = (h: number) => `${String(h).padStart(2, '0')}:00`;
