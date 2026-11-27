/**
 * 통계·휴면 업무 규칙 (단계 9): 운영 통계(F-ADM-STA-02)·기사 성과(F-ADM-STA-03)·고객·CRM 통계(F-ADM-STA-04)·휴면 전환(F-SYS-13).
 * 비율은 % 소수 첫째 자리, 분모가 0이면 null(화면에 "-").
 * 휴면 기준 개월·사전 안내 일수·사용 여부는 system_setting(DORMANT_*)에서 읽는다(법무 확인 기준, 기본 사용 안 함).
 */
import { addMonthsToDate } from './ops-rules';

export const pctOf = (part: number, total: number): number | null => (total > 0 ? Math.round((part / total) * 1000) / 10 : null);
export const avgOf = (values: readonly number[]): number | null =>
  values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;

/* ---------- 운영 통계 (F-ADM-STA-02) ---------- */

export interface OpsCounts {
  /** 기간 안 약속 주문(취소 포함) */
  orders: number;
  completed: number;
  canceled: number;
  /** 한 번이라도 미처리(PENDING)였던 주문 */
  pendingEver: number;
  slotCapacity: number;
  slotBooked: number;
}

export function opsRates(c: OpsCounts) {
  return {
    completedRate: pctOf(c.completed, c.orders),
    cancelRate: pctOf(c.canceled, c.orders),
    pendingRate: pctOf(c.pendingEver, c.orders - c.canceled),
    slotUtilization: pctOf(c.slotBooked, c.slotCapacity),
  };
}

/** 기기 유형별 평균 작업시간(분): 작업 1건이 여러 유형이면 각 유형에 같은 작업시간을 넣는다 */
export function avgWorkMinutesByType(rows: readonly { deviceTypes: readonly string[]; workMinutes: number | null }[]) {
  const acc = new Map<string, number[]>();
  for (const r of rows) {
    if (r.workMinutes === null || r.workMinutes <= 0) continue;
    for (const t of new Set(r.deviceTypes)) acc.set(t, [...(acc.get(t) ?? []), r.workMinutes]);
  }
  return [...acc.entries()].map(([deviceType, v]) => ({ deviceType, jobs: v.length, avgMinutes: avgOf(v)! })).sort((a, b) => a.deviceType.localeCompare(b.deviceType));
}

/* ---------- 기사 성과 (F-ADM-STA-03, BR-051) ---------- */

export interface TechPerfInput {
  techId: number;
  name: string;
  jobs: number;
  sales: number;
  ratings: readonly number[];
  vocComplaints: number;
  /** BR-051 귀책 AS 건수 */
  asCount: number;
  workMinutes: readonly number[];
}

export function techPerformance(rows: readonly TechPerfInput[]) {
  return rows
    .map((r) => ({
      techId: r.techId,
      name: r.name,
      jobs: r.jobs,
      sales: r.sales,
      ratingAvg: r.ratings.length ? Math.round((r.ratings.reduce((s, v) => s + v, 0) / r.ratings.length) * 100) / 100 : null,
      reviewCount: r.ratings.length,
      vocComplaints: r.vocComplaints,
      asCount: r.asCount,
      asRate: pctOf(r.asCount, r.jobs),
      avgWorkMinutes: avgOf(r.workMinutes),
    }))
    .sort((a, b) => b.jobs - a.jobs || b.sales - a.sales || a.techId - b.techId);
}

/* ---------- 고객·CRM 통계 (F-ADM-STA-04) ---------- */

/**
 * 기간 안 완료 고객을 신규(그 전에 완료 주문 없음)·재방문으로 나눈다.
 * firstCompletedAt = 고객의 첫 완료 주문 시각(한국 날짜), periodStart 이상이면 신규.
 */
export function newVsRepeat(customers: readonly { firstCompletedDate: string }[], periodStart: string) {
  const fresh = customers.filter((c) => c.firstCompletedDate >= periodStart).length;
  const repeat = customers.length - fresh;
  return { total: customers.length, fresh, repeat, repeatRate: pctOf(repeat, customers.length) };
}

/** 분포(코드 → 건수, 비율) 내림차순 */
export function distribution(values: readonly (string | null)[], unknownKey = 'UNKNOWN') {
  const m = new Map<string, number>();
  for (const v of values) m.set(v ?? unknownKey, (m.get(v ?? unknownKey) ?? 0) + 1);
  return [...m.entries()].map(([key, count]) => ({ key, count, rate: pctOf(count, values.length) })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/* ---------- 휴면 전환 (F-SYS-13) ---------- */

/** 마지막 이용일 = max(최근 작업일, 최근 주문 접수일, 가입일) (한국 날짜) */
export function lastActivityDate(dates: readonly (string | null)[]): string | null {
  const v = dates.filter((d): d is string => Boolean(d)).sort();
  return v.length ? v[v.length - 1]! : null;
}

/** 휴면 전환 대상: 활동 고객 + 진행 중 주문 없음 + 마지막 이용일 ≤ 오늘 − N개월 */
export function isDormantTarget(i: { status: string; lastActivity: string | null; hasActiveOrder: boolean; today: string; months: number }): boolean {
  if (i.status !== 'ACTIVE' || i.hasActiveOrder || !i.lastActivity) return false;
  return i.lastActivity <= addMonthsToDate(i.today, -i.months);
}

/** 휴면 사전 안내 대상: 전환 예정일(마지막 이용일 + N개월)까지 noticeDays 이하로 남았고, 이번 주기에 안내하지 않음 */
export function isDormantNoticeDue(i: {
  status: string;
  lastActivity: string | null;
  hasActiveOrder: boolean;
  today: string;
  months: number;
  noticeDays: number;
  /** 마지막 휴면 안내 날짜(한국 날짜) */
  lastNoticedAt: string | null;
}): boolean {
  if (i.status !== 'ACTIVE' || i.hasActiveOrder || !i.lastActivity) return false;
  const due = addMonthsToDate(i.lastActivity, i.months);
  const daysLeft = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${i.today}T00:00:00Z`)) / 86_400_000);
  if (daysLeft > i.noticeDays || daysLeft <= 0) return false;
  return !i.lastNoticedAt || i.lastNoticedAt < i.lastActivity;
}
