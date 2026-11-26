/**
 * 운영 마감 업무 규칙 (단계 8-2, 04 §2 단계 8): 재방문 캠페인·개인정보 파기·공지·KPI·매출 통계 묶음.
 * - BR-091 최근 작업 후 REVISIT_MONTHS(11)개월 지난 마케팅 동의 고객만 재방문 알림
 * - BR-101 마케팅 동의 철회 고객은 캠페인 대상에서 즉시 제외(추출 때마다 다시 확인)
 * - BR-102 거점 소속 관리자는 자기 거점 공지만 쓴다
 * - ERD §5 KPI 산출식, ERD §6 보관·파기
 * 기준값(개월·연수·목표값)은 system_setting 에서 읽어 넘긴다(CLAUDE.md §5).
 */
import { MSG } from '../messages';
import { isoWeek } from '../settlement/settlement-rules';

/* ---------- 날짜 ---------- */

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD 에 개월 수를 더한다(음수 가능). 그 달에 없는 날이면 말일로 맞춘다 */
export function addMonthsToDate(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}

/* ---------- 재방문 자동 캠페인 (BR-091·101, F-ADM-CRM-01, F-SYS-06) ---------- */

/**
 * 재방문 대상: 활동 고객 + 마케팅 동의(BR-091·101) + 최근 작업일 ≤ 기준일(오늘 − N개월)
 * + 진행 중 주문 없음 + 이번 작업 이후로 아직 보내지 않음(같은 작업 주기에는 1회만).
 */
export function isRevisitTarget(c: {
  status: string;
  marketingAgree: boolean;
  lastServiceDate: string | null;
  /** 이 캠페인으로 마지막 발송한 날짜(한국 날짜) */
  lastTargetedAt: string | null;
  hasActiveOrder: boolean;
  /** 오늘 − REVISIT_MONTHS 개월 */
  cutoff: string;
}): boolean {
  if (c.status !== 'ACTIVE' || !c.marketingAgree || c.hasActiveOrder) return false;
  if (!c.lastServiceDate || c.lastServiceDate > c.cutoff) return false;
  return !c.lastTargetedAt || c.lastTargetedAt < c.lastServiceDate;
}

/** 캠페인 전환: 발송 후 windowDays 안에 접수한 첫 주문(취소 제외) */
export function matchConversion(sentAt: Date, orders: readonly { id: number; createdAt: Date; status: string }[], windowDays: number): number | null {
  const end = sentAt.getTime() + windowDays * 86_400_000;
  const hit = [...orders]
    .filter((o) => o.status !== 'CANCELED' && o.createdAt.getTime() >= sentAt.getTime() && o.createdAt.getTime() <= end)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  return hit?.id ?? null;
}

/* ---------- 개인정보 파기 (ERD §6, F-SYS-12, F-ADM-CUS-05) ---------- */

/** 파기 예정일: 탈퇴 고객 = 탈퇴일 + 보관 연수, 그 외 = 최종 거래일(없으면 가입일) + 보관 연수 */
export function purgeDueDateOf(
  c: { status: string; withdrawnDate: string | null; lastServiceDate: string | null; createdDate: string },
  years: number,
): string {
  const base = c.status === 'WITHDRAWN' && c.withdrawnDate ? c.withdrawnDate : (c.lastServiceDate ?? c.createdDate);
  return addMonthsToDate(base, years * 12);
}

/** 파기 대상: 예정일이 오늘 이전(포함)이고 아직 파기 전 */
export const isPurgeDue = (c: { status: string; purgeDueDate: string | null }, today: string) =>
  c.status !== 'PURGED' && c.purgeDueDate !== null && c.purgeDueDate <= today;

/** 파기 후 이름 자리에 남기는 문구(암호화해서 저장) */
export const PURGED_NAME = '파기된 고객';

/* ---------- 공지 (F-ADM-CNT-01, F-TEC-HOM-01) ---------- */

export interface NoticeLike {
  noticeType: string;
  targetAudience: string;
  branchId: number | null;
  publishFrom: Date | null;
  publishTo: Date | null;
}

/** 게시 기간 안이고 보는 사람이 대상일 때 (거점 공지는 그 거점 소속만, 고객 공지는 고객만) */
export function noticeVisibleTo(n: NoticeLike, viewer: { kind: 'TECHNICIAN' | 'ADMIN' | 'CUSTOMER'; branchId: number | null }, now: Date): boolean {
  if (n.publishFrom && n.publishFrom.getTime() > now.getTime()) return false;
  if (n.publishTo && n.publishTo.getTime() < now.getTime()) return false;
  if (n.targetAudience !== 'ALL' && n.targetAudience !== viewer.kind) return false;
  if (n.noticeType === 'CUSTOMER') return viewer.kind === 'CUSTOMER';
  if (viewer.kind === 'CUSTOMER') return n.noticeType === 'ALL' && n.targetAudience === 'ALL';
  if (n.noticeType === 'BRANCH') return n.branchId !== null && n.branchId === viewer.branchId;
  return true;
}

/** BR-102 공지 작성 범위: 전체 범위 관리자는 모두, 거점 소속 관리자는 자기 거점 공지만 */
export function canWriteNotice(scope: { kind: 'ALL' } | { kind: 'BRANCH'; branchId: number } | { kind: 'NONE' }, n: { noticeType: string; branchId: number | null }): string | null {
  if (n.noticeType === 'BRANCH' && !n.branchId) return MSG.required('거점');
  if (scope.kind === 'ALL') return null;
  if (scope.kind === 'BRANCH' && n.noticeType === 'BRANCH' && n.branchId === scope.branchId) return null;
  return '거점 소속 관리자는 자기 거점 공지만 등록할 수 있습니다.';
}

/** 상단 고정 먼저, 그다음 게시 시작 최신 순 */
export function sortNotices<T extends { isPinned: boolean; publishFrom: Date | null }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || (b.publishFrom?.getTime() ?? 0) - (a.publishFrom?.getTime() ?? 0));
}

/* ---------- KPI (ERD §5, F-ADM-DSH-02) ---------- */

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/** 건당 객단가·마진율 = (매출 − 정산 지급 − 자재원가) ÷ 매출 */
export function kpiMargin(i: { revenue: number; jobs: number; techPay: number; materialCost: number }) {
  return {
    avgTicket: i.jobs > 0 ? Math.round(i.revenue / i.jobs) : null,
    marginRate: pct(i.revenue - i.techPay - i.materialCost, i.revenue),
  };
}

/** 재방문율 = 전년 동기 완료 고객 중 금년 재주문 고객 비율 */
export function kpiRevisitRate(i: { baseCustomers: readonly number[]; reorderedCustomers: readonly number[] }) {
  const base = new Set(i.baseCustomers);
  const re = new Set(i.reorderedCustomers);
  return pct([...base].filter((c) => re.has(c)).length, base.size);
}

/** 기사 6개월 정착률 = 입사 후 6개월 지난 기사 중 status ≠ LEFT 비율 */
export function kpiRetention(techs: readonly { joinedAt: string | null; status: string }[], today: string) {
  const cutoff = addMonthsToDate(today, -6);
  const eligible = techs.filter((t) => t.joinedAt !== null && t.joinedAt <= cutoff);
  return pct(eligible.filter((t) => t.status !== 'LEFT').length, eligible.length);
}

/** 성수기 = 5~8월 */
export const isPeakMonth = (month: number) => month >= 5 && month <= 8;

/** 비수기/성수기 매출 비 = (9~4월 월평균 매출) ÷ (5~8월 월평균 매출). month = YYYY-MM */
export function kpiOffPeakRatio(months: readonly { month: string; revenue: number }[]) {
  const peak = months.filter((m) => isPeakMonth(Number(m.month.slice(5, 7))));
  const off = months.filter((m) => !isPeakMonth(Number(m.month.slice(5, 7))));
  if (!peak.length || !off.length) return null;
  const avg = (xs: typeof months) => xs.reduce((s, x) => s + x.revenue, 0) / xs.length;
  return pct(avg(off), avg(peak));
}

/** AS·불만율 = (AS 요청 + 불만 VOC) ÷ 완료 건수 */
export const kpiAsComplaintRate = (i: { asCount: number; complaintCount: number; completed: number }) => pct(i.asCount + i.complaintCount, i.completed);

/** 고객 획득비 = 마케팅비 ÷ 신규 고객 수, 객단가 대비 비율 */
export function kpiCac(i: { marketingCost: number | null; newCustomers: number; avgTicket: number | null }) {
  if (i.marketingCost === null || i.newCustomers <= 0) return { cac: null, cacRate: null };
  const cac = Math.round(i.marketingCost / i.newCustomers);
  return { cac, cacRate: i.avgTicket ? pct(cac, i.avgTicket) : null };
}

/** NPS = (추천 9~10 비율 − 비추천 0~6 비율) × 100 */
export function kpiNps(scores: readonly number[]) {
  if (!scores.length) return null;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 1000) / 10;
}

/** 목표 대비 판정 */
export function evaluateKpi(value: number | null, target: number | null, better: 'HIGHER' | 'LOWER'): 'MET' | 'BELOW' | 'NA' {
  if (value === null || target === null) return 'NA';
  return (better === 'HIGHER' ? value >= target : value <= target) ? 'MET' : 'BELOW';
}

/* ---------- 매출 통계 (F-ADM-STA-01) ---------- */

export type StatUnit = 'DAY' | 'WEEK' | 'MONTH';

/** 일(YYYY-MM-DD)·주(YYYY-Www, ISO)·월(YYYY-MM) 묶음 키 */
export function bucketOf(date: string, unit: StatUnit): string {
  if (unit === 'DAY') return date;
  if (unit === 'MONTH') return date.slice(0, 7);
  const { year, week } = isoWeek(date);
  return `${year}-W${pad(week)}`;
}
