/**
 * 상담 콘솔 업무 규칙 (02 F-ADM-CSL-01~10, 03 §4.3 A-CSL-010).
 * - BR-022 고객 선택 시 Alert(미완료 상담 → 미완료 클레임 → 당일 상담 이력)
 * - BR-023 개인정보 동의 미질의 고객은 동의 팝업 자동 호출(재질의 주기 = system_setting PRIVACY_REASK_MONTHS)
 * - BR-024 기사 미선택 저장 = ASSIGN_WAIT(미지정·긴급)
 * - BR-011·012 약속일시 야간·휴일 할증 안내(F-ADM-CSL-09)
 * - F-ADM-CSL-06 Time Table(7일 × 08~18시), F-ADM-CSL-07·08 출장 가능·휴일 당직 기사
 * 기준값은 system_setting 에서 읽어 넘긴다(CLAUDE.md §5).
 */
import type { OrderStatus } from '../order/order-status';
import { kstDate } from '../quote/quote-status';
import { type ScheduleLike, type SlotDefaults, type SlotKind, hourToTime, hoursOf } from '../slot/slot';

/* ---------- BR-023 개인정보 동의 팝업 ---------- */

export type PrivacyAgreeStatus = 'AGREED' | 'DISAGREED' | 'NOT_ASKED';

/**
 * BR-023 동의 팝업을 자동으로 띄울지.
 * - 질의못함(NOT_ASKED): 항상 다시 묻는다.
 * - 미동의(DISAGREED): 마지막 응답 후 재질의 주기(개월)가 지났으면 다시 묻는다.
 * - 동의(AGREED): 묻지 않는다(철회 버튼만 노출).
 */
export function needsConsentPrompt(i: {
  status: string;
  /** 마지막 동의 응답(AGREE/DISAGREE/WITHDRAW) 일시 */
  lastAnsweredAt: Date | null;
  now: Date;
  /** PRIVACY_REASK_MONTHS */
  reaskMonths: number;
}): boolean {
  if (i.status === 'NOT_ASKED') return true;
  if (i.status !== 'DISAGREED') return false;
  if (!i.lastAnsweredAt) return true;
  const due = new Date(i.lastAnsweredAt);
  due.setMonth(due.getMonth() + Math.max(i.reaskMonths, 0));
  return i.now.getTime() >= due.getTime();
}

/** A-CSL-013 응답 → consent_history.action · customer.privacy_agree_status */
export function consentAnswerToStatus(action: 'AGREE' | 'DISAGREE' | 'NOT_ASKED' | 'WITHDRAW'): PrivacyAgreeStatus {
  if (action === 'AGREE') return 'AGREED';
  if (action === 'NOT_ASKED') return 'NOT_ASKED';
  return 'DISAGREED';
}

/** 동의 철회 버튼은 동의 고객에게만 노출 (F-ADM-CSL-03) */
export const canWithdrawPrivacy = (status: string) => status === 'AGREED';

/* ---------- BR-022 고객 선택 시 Alert ---------- */

export type ConsoleAlertKind = 'OPEN_CONSULT' | 'OPEN_CLAIM' | 'TODAY_CONSULT';

/** BR-022 Alert 순서(03 §4.3): 미완료 상담 → 미완료 클레임 → 당일 상담 이력. 0건은 띄우지 않는다 */
export function consoleAlerts(i: { openConsults: number; openClaims: number; todayConsults: number }): { kind: ConsoleAlertKind; count: number; message: string }[] {
  const list: { kind: ConsoleAlertKind; count: number; message: string }[] = [
    { kind: 'OPEN_CONSULT', count: i.openConsults, message: `미완료 상담이 ${i.openConsults}건 있습니다. 상담 이력을 먼저 확인하세요.` },
    { kind: 'OPEN_CLAIM', count: i.openClaims, message: `처리 중인 클레임이 ${i.openClaims}건 있습니다. 클레임 내용을 먼저 확인하세요.` },
    { kind: 'TODAY_CONSULT', count: i.todayConsults, message: `오늘 이미 상담한 이력이 ${i.todayConsults}건 있습니다.` },
  ];
  return list.filter((a) => a.count > 0);
}

/* ---------- BR-024 출장접수 저장 상태 ---------- */

/**
 * BR-024 출장접수 저장 시 주문 상태 경로(첫 상태부터 차례로 이력 1행씩).
 * - 기사 선택 → 접수 후 바로 배정완료(RECEIVED → ASSIGNED)
 * - 미선택 → 배정대기(미지정·긴급, ASSIGN_WAIT)
 * - 2인 방문 건은 주기사를 골라도 지원기사가 붙기 전까지 배정대기(02 F-ADM-DSP-01 ⑤, 지원기사 추가는 배정 보드 단계 4-1)
 */
export function phoneOrderStatusPath(i: { technicianSelected: boolean; requiredTechCount: number }): OrderStatus[] {
  return i.technicianSelected && i.requiredTechCount <= 1 ? ['RECEIVED', 'ASSIGNED'] : ['ASSIGN_WAIT'];
}

/* ---------- F-ADM-CSL-05 약속일시 검증 · F-ADM-CSL-09 할증 안내 ---------- */

/** 약속 일시(한국 시각) */
export const promisedAtOf = (date: string, hour: number) => new Date(`${date}T${hourToTime(hour)}:00+09:00`);

/** 지난 일시면 02 F-ADM-CSL-05 검증 문구, 아니면 null */
export function validatePromisedAt(date: string, hour: number, now: Date): string | null {
  const at = promisedAtOf(date, hour);
  if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return '약속일시의 일자 정보가 잘못되었습니다.';
  return null;
}

/** BR-011·012 야간·휴일 약속 안내 문구 (02 F-ADM-CSL-05 검증 메시지). 할증이 없으면 null */
export function visitSurchargeNotice(rule: { ruleCode: string; amount: number } | null): string | null {
  if (!rule) return null;
  const won = `${rule.amount.toLocaleString('ko-KR')}원`;
  if (rule.ruleCode === 'NIGHT') return `[평일 야간 약속 안내] 야간 방문 시 할증 ${won}이 추가됩니다.`;
  if (rule.ruleCode === 'HOLIDAY') return `[휴일 약속 안내] 휴일 방문 시 할증 ${won}이 추가됩니다.`;
  return null;
}

/* ---------- F-ADM-CSL-06 Time Table ---------- */

/** Time Table 시간대 (03 §4.3: 08~18시) */
export const TIME_TABLE_HOURS: readonly number[] = Array.from({ length: 11 }, (_, i) => 8 + i);

/** 기준일부터 7일 (한국 날짜 YYYY-MM-DD) */
export function timeTableDates(start: string): string[] {
  const [y, m, d] = start.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(y!, m! - 1, d! + i)).toISOString().slice(0, 10));
}

/** <7일전 | 7일후> 이동 */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

export interface TimeTableSlot {
  slotDate: string;
  slotHour: number;
  slotKind: string;
  capacity: number;
  bookedCount: number;
  isClosed: boolean;
}

export interface TimeTableRow {
  date: string;
  /** 0=일 … 6=토 */
  dow: number;
  holiday: boolean;
  /** remaining=null 이면 그 시간 슬롯 없음(근무 기사 없음) */
  cells: { hour: number; remaining: number | null; capacity: number; past: boolean }[];
  contract: number;
  urgent: number;
  onCall: number;
}

const remainingOf = (s: TimeTableSlot) => (s.isClosed ? 0 : Math.max(s.capacity - s.bookedCount, 0));

/** F-ADM-CSL-06 7일 × 시간대 잔여 건수 + 계약·긴급·당직 열(그날 잔여 합) */
export function buildTimeTable(i: { dates: readonly string[]; slots: readonly TimeTableSlot[]; holidays: readonly string[]; now: Date; hours?: readonly number[] }): TimeTableRow[] {
  const hours = i.hours ?? TIME_TABLE_HOURS;
  return i.dates.map((date) => {
    const day = i.slots.filter((s) => s.slotDate === date);
    const kindSum = (k: SlotKind) => day.filter((s) => s.slotKind === k).reduce((n, s) => n + remainingOf(s), 0);
    return {
      date,
      dow: new Date(`${date}T00:00:00Z`).getUTCDay(),
      holiday: i.holidays.includes(date),
      cells: hours.map((hour) => {
        const s = day.find((x) => x.slotKind === 'NORMAL' && x.slotHour === hour);
        return { hour, remaining: s ? remainingOf(s) : null, capacity: s?.capacity ?? 0, past: promisedAtOf(date, hour).getTime() <= i.now.getTime() };
      }),
      contract: kindSum('CONTRACT'),
      urgent: kindSum('URGENT'),
      onCall: kindSum('ON_CALL'),
    };
  });
}

/* ---------- F-ADM-CSL-07 출장 가능 기사 · F-ADM-CSL-08 휴일 근무 기사 ---------- */

export interface TechLike {
  id: number;
  name: string;
  grade: string;
}

export interface TechBusy {
  technicianId: number;
  /** 약속 시작~종료 시각(시, 종료 미포함) */
  fromHour: number;
  toHour: number;
}

export type TechAvailability = TechLike & {
  scheduleType: string;
  workHours: number[];
  /** 그날 약속 수 */
  appointments: number;
  available: boolean;
  /** 선택할 수 없는 이유 */
  reason: 'NOT_WORKING_HOURS' | 'BUSY' | null;
};

/**
 * F-ADM-CSL-07 그날 근무(근무·반차·당직)하는 기사 중 [startHour, startHour+needHours) 에 일할 수 있는 기사.
 * 근무 시간 밖이거나 다른 약속과 겹치면 available=false 로 함께 보여 준다(선택 불가). 선택 가능 → 약속 적은 순.
 */
export function availableTechnicians(i: {
  techs: readonly TechLike[];
  schedules: readonly ScheduleLike[];
  busy: readonly TechBusy[];
  startHour: number;
  needHours: number;
  defaults: Pick<SlotDefaults, 'defaultStart' | 'defaultEnd'>;
}): TechAvailability[] {
  const want = Array.from({ length: Math.max(i.needHours, 1) }, (_, k) => i.startHour + k);
  return i.techs
    .flatMap((t) => {
      const s = i.schedules.find((x) => x.technicianId === t.id);
      if (!s) return [];
      const workHours = hoursOf(s, i.defaults);
      if (workHours.length === 0) return [];
      const mine = i.busy.filter((b) => b.technicianId === t.id);
      const inHours = want.every((h) => workHours.includes(h));
      const overlap = mine.some((b) => want.some((h) => h >= b.fromHour && h < b.toHour));
      const reason: TechAvailability['reason'] = !inHours ? 'NOT_WORKING_HOURS' : overlap ? 'BUSY' : null;
      return [{ ...t, scheduleType: s.scheduleType, workHours, appointments: mine.length, available: reason === null, reason }];
    })
    .sort((a, b) => Number(b.available) - Number(a.available) || a.appointments - b.appointments || a.name.localeCompare(b.name, 'ko'));
}

/** F-ADM-CSL-08 그날 휴일 당직(ON_CALL) 기사 */
export function onCallTechnicians<T extends TechLike>(techs: readonly T[], schedules: readonly ScheduleLike[], date: string): T[] {
  const ids = new Set(schedules.filter((s) => s.workDate === date && s.scheduleType === 'ON_CALL').map((s) => s.technicianId));
  return techs.filter((t) => ids.has(t.id));
}

/** 오늘(한국 날짜) — Time Table 기본 시작일 */
export const consoleToday = (now: Date) => kstDate(now);
