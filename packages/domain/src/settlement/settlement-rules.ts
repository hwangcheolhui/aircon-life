/**
 * 정산 규칙 (단계 7: F-ADM-STL-01~04, F-TEC-STL-01·02, F-SYS-10, BR-080~084, 01 §2.11·§3.3).
 * 관리자 화면·기사 앱·주간 배치가 같은 계산을 쓰도록 순수 함수로 둔다. 금액은 원 단위 정수.
 *
 * 계산 요약 (02 F-ADM-STL-02):
 * - 대상: 정산 기간 끝(일요일)까지 결제가 끝나 완료(COMPLETED)된 작업 중 아직 어느 정산에도 들어가지 않은 건(BR-081).
 * - 건별 기사 배분: 작업비(주문 합계 − 추가요금) × 배분율(RATE) / 대당 금액 × 대수(PER_UNIT) / 둘의 합(MIXED).
 *   2인 작업은 배분액을 주기사 (100 − 지원율)% · 지원기사 지원율%로 나눈다(지원기사가 여럿이면 지원 몫을 똑같이 나눔).
 *   추가요금은 추가요금 × 추가요금 배분율로 주기사에게. 교육 동행(ACCOMPANY)은 0원.
 * - 합계: 과세 대상 = 기본 배분 + 추가요금 배분 + 인센티브 − 공제 → 원천세(도급 FREELANCER만, BR-083, 10원 미만 절사)
 *   → 실지급 = 과세 대상 − 원천세 − 현장 수금 현금(BR-082).
 * - 확정된 정산은 바꾸지 않고, 고칠 내용은 다음 회차의 조정(ADJUST) 항목으로 넣는다(BR-084).
 */
import { MSG } from '../messages';
import type { FieldErrors } from '../payment/payment-rules';

/* ---------- 상태 (01 §3.3) ---------- */

export const SETTLEMENT_BATCH_STATUSES = ['DRAFT', 'CALCULATED', 'CONFIRMED', 'PAID', 'CLOSED'] as const;
export type SettlementBatchStatus = (typeof SETTLEMENT_BATCH_STATUSES)[number];

export const SETTLEMENT_STATUSES = ['CALCULATED', 'TECH_CONFIRMED', 'DISPUTED', 'CONFIRMED', 'PAID'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/** 회차: DRAFT → CALCULATED → CONFIRMED → PAID → CLOSED */
export const SETTLEMENT_BATCH_TRANSITIONS: Readonly<Record<SettlementBatchStatus, readonly SettlementBatchStatus[]>> = {
  DRAFT: ['CALCULATED'],
  CALCULATED: ['CONFIRMED'],
  CONFIRMED: ['PAID'],
  PAID: ['CLOSED'],
  CLOSED: [],
};

/**
 * 기사별: CALCULATED → TECH_CONFIRMED | DISPUTED → CONFIRMED → PAID.
 * 회차 확정 때 기사가 아직 답하지 않은 정산서(CALCULATED)도 함께 확정한다(단계 7 구현, 01 §3.3 메모).
 */
export const SETTLEMENT_TRANSITIONS: Readonly<Record<SettlementStatus, readonly SettlementStatus[]>> = {
  CALCULATED: ['TECH_CONFIRMED', 'DISPUTED', 'CONFIRMED'],
  TECH_CONFIRMED: ['CONFIRMED'],
  DISPUTED: ['CONFIRMED'],
  CONFIRMED: ['PAID'],
  PAID: [],
};

export function canTransitionBatch(from: string, to: SettlementBatchStatus): boolean {
  return (SETTLEMENT_BATCH_TRANSITIONS[from as SettlementBatchStatus] ?? []).includes(to);
}
export function assertBatchTransition(from: string, to: SettlementBatchStatus): void {
  if (!canTransitionBatch(from, to)) throw new Error(`정산 회차 상태를 ${from}에서 ${to}(으)로 바꿀 수 없습니다.`);
}
export function canTransitionSettlement(from: string, to: SettlementStatus): boolean {
  return (SETTLEMENT_TRANSITIONS[from as SettlementStatus] ?? []).includes(to);
}
export function assertSettlementTransition(from: string, to: SettlementStatus): void {
  if (!canTransitionSettlement(from, to)) throw new Error(`정산서 상태를 ${from}에서 ${to}(으)로 바꿀 수 없습니다.`);
}

/** BR-084 확정 이후(CONFIRMED·PAID)는 금액·항목을 바꿀 수 없다 */
export function isSettlementLocked(status: string): boolean {
  return status === 'CONFIRMED' || status === 'PAID';
}

/** 조정 항목을 넣을 수 있는 정산서: 회차가 계산됨이고, 기사가 아직 확인하지 않았거나 이의를 낸 상태 */
export function canAdjustSettlement(batchStatus: string, settlementStatus: string | null): boolean {
  if (batchStatus !== 'CALCULATED') return false;
  return settlementStatus === null || settlementStatus === 'CALCULATED' || settlementStatus === 'DISPUTED';
}

/** 회차 확정 가능: 이의(DISPUTED)가 남아 있지 않아야 한다 */
export function checkBatchConfirm(batchStatus: string, settlementStatuses: readonly string[]): string | null {
  if (batchStatus !== 'CALCULATED') return '계산이 끝난 회차만 확정할 수 있습니다.';
  const disputed = settlementStatuses.filter((s) => s === 'DISPUTED').length;
  if (disputed) return `이의 제기된 정산서 ${disputed}건을 먼저 처리해 주세요.`;
  return null;
}

/* ---------- 기간·회차 번호 (BR-080) ---------- */

const DAY = 86_400_000;
const parseDate = (s: string) => new Date(`${s}T00:00:00Z`);
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
export const stlShiftDate = (s: string, n: number) => fmtDate(new Date(parseDate(s).getTime() + n * DAY));

/** 날짜(YYYY-MM-DD)가 속한 주의 월~일 */
export function weekOf(date: string): { periodStart: string; periodEnd: string } {
  const dow = (parseDate(date).getUTCDay() + 6) % 7; // 월=0 … 일=6
  const periodStart = stlShiftDate(date, -dow);
  return { periodStart, periodEnd: stlShiftDate(periodStart, 6) };
}

/** F-SYS-10 전주(월~일): 기준 날짜(한국 날짜)의 지난주 */
export function previousWeek(today: string): { periodStart: string; periodEnd: string } {
  return weekOf(stlShiftDate(today, -7));
}

export function isMonday(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && parseDate(date).getUTCDay() === 1;
}

/** ISO 주차 (월요일 시작, 그 주 목요일이 속한 해) */
export function isoWeek(date: string): { year: number; week: number } {
  const { periodStart } = weekOf(date);
  const thursday = parseDate(stlShiftDate(periodStart, 3));
  const year = thursday.getUTCFullYear();
  const jan4 = parseDate(`${year}-01-04`);
  const week1Monday = parseDate(weekOf(fmtDate(jan4)).periodStart);
  return { year, week: Math.round((parseDate(periodStart).getTime() - week1Monday.getTime()) / (7 * DAY)) + 1 };
}

/** 회차 번호 `S2026-W47` (01 §2.11.2). 거점 회차는 뒤에 거점 코드를 붙인다 `S2026-W47-EP01` */
export function batchNoOf(periodStart: string, branchCode?: string | null): string {
  const { year, week } = isoWeek(periodStart);
  const base = `S${year}-W${String(week).padStart(2, '0')}`;
  return branchCode ? `${base}-${branchCode}` : base;
}

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

/** BR-080 지급 예정일: 기간 끝(일요일) 다음 주의 SETTLEMENT_WEEKDAY 요일 */
export function scheduledPayDateOf(periodEnd: string, weekday: string): string {
  const idx = WEEKDAYS.indexOf(weekday.trim().toUpperCase() as (typeof WEEKDAYS)[number]);
  return stlShiftDate(periodEnd, (idx < 0 ? 2 : idx) + 1);
}

/* ---------- 수수료 정책 선택 (F-ADM-STL-01) ---------- */

export const COMMISSION_CALC_TYPES = ['RATE', 'PER_UNIT', 'MIXED'] as const;
export type CommissionCalcType = (typeof COMMISSION_CALC_TYPES)[number];

export interface CommissionPolicyLike {
  id: number;
  policyName: string;
  techGrade: string | null;
  contractType: string | null;
  branchId: number | null;
  calcType: string;
  techShareRate: number | null;
  perUnitAmount: number | null;
  extraChargeShareRate: number | null;
  supportRoleRate: number | null;
  withholdingRate: number | null;
  validFrom: string | null;
  validTo: string | null;
}

/**
 * 기사에게 맞는 정책 1개: 거점·등급·계약형태가 맞거나 비어 있는(전체) 정책 중 기준일에 유효한 것.
 * 더 구체적인 정책이 이긴다(거점 > 등급 > 계약형태), 같으면 늦게 시작한 정책.
 */
export function selectCommissionPolicy<P extends CommissionPolicyLike>(
  policies: readonly P[],
  tech: { grade: string; contractType: string; branchId: number },
  date: string,
): P | null {
  const score = (p: P) => (p.branchId !== null ? 4 : 0) + (p.techGrade !== null ? 2 : 0) + (p.contractType !== null ? 1 : 0);
  const fits = policies.filter(
    (p) =>
      (p.techGrade === null || p.techGrade === tech.grade) &&
      (p.contractType === null || p.contractType === tech.contractType) &&
      (p.branchId === null || p.branchId === tech.branchId) &&
      (p.validFrom === null || p.validFrom <= date) &&
      (p.validTo === null || p.validTo >= date),
  );
  fits.sort((a, b) => score(b) - score(a) || (b.validFrom ?? '').localeCompare(a.validFrom ?? '') || b.id - a.id);
  return fits[0] ?? null;
}


/** 정책 입력 검증: 계산 방식별 필수값, 비율 0~100 */
export function checkCommissionPolicy(p: {
  calcType: string;
  techShareRate: number | null;
  perUnitAmount: number | null;
  extraChargeShareRate: number | null;
  supportRoleRate: number | null;
  withholdingRate: number | null;
}): FieldErrors {
  const e: FieldErrors = {};
  if (!(COMMISSION_CALC_TYPES as readonly string[]).includes(p.calcType)) e.calcType = MSG.required('계산 방식');
  if ((p.calcType === 'RATE' || p.calcType === 'MIXED') && p.techShareRate === null) e.techShareRate = MSG.required('기사 배분율');
  if ((p.calcType === 'PER_UNIT' || p.calcType === 'MIXED') && p.perUnitAmount === null)
    e.perUnitAmount = MSG.required('대당 지급액');
  const rates: [keyof typeof p, string][] = [
    ['techShareRate', '기사 배분율'],
    ['extraChargeShareRate', '추가요금 배분율'],
    ['supportRoleRate', '지원기사 배분율'],
    ['withholdingRate', '원천징수율'],
  ];
  for (const [k, label] of rates) {
    const v = p[k] as number | null;
    if (v !== null && (Number.isNaN(v) || v < 0 || v > 100)) e[k] = `${label}은(는) 0~100 사이여야 합니다.`;
  }
  if (p.perUnitAmount !== null && p.perUnitAmount < 0) e.perUnitAmount = '대당 지급액은 0 이상이어야 합니다.';
  return e;
}

/* ---------- 건별 배분 (F-ADM-STL-02) ---------- */

export const SETTLEMENT_ITEM_TYPES = ['JOB', 'EXTRA', 'INCENTIVE', 'DEDUCTION', 'ADJUST'] as const;
export type SettlementItemType = (typeof SETTLEMENT_ITEM_TYPES)[number];
/** 관리자가 직접 넣는 항목 (F-ADM-STL-03) */
export const MANUAL_ITEM_TYPES = ['INCENTIVE', 'DEDUCTION', 'ADJUST'] as const;
export type ManualItemType = (typeof MANUAL_ITEM_TYPES)[number];

export type SettlementRole = 'MAIN' | 'SUPPORT' | 'ACCOMPANY';

export interface JobShareInput {
  /** 주문 합계(부가세 포함, 추가요금 포함) */
  totalAmount: number;
  /** 고객이 동의한 현장 추가요금 합계 */
  extraAmount: number;
  /** 작업 대수 (작업 불가 항목 제외) */
  units: number;
  mainTechnicianId: number;
  supportTechnicianIds: readonly number[];
  accompanyTechnicianIds: readonly number[];
}

export interface ShareItem {
  technicianId: number;
  role: SettlementRole;
  itemType: 'JOB' | 'EXTRA';
  salesAmount: number;
  /** 실제 적용 비율(%) — 대당 계산(PER_UNIT)만이면 null */
  shareRate: number | null;
  payAmount: number;
  memo: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 정책으로 본 작업 1건의 기사 몫(나누기 전) */
export function poolOf(policy: CommissionPolicyLike, jobSales: number, units: number): number {
  const rate = policy.techShareRate ?? 0;
  const perUnit = policy.perUnitAmount ?? 0;
  switch (policy.calcType) {
    case 'PER_UNIT':
      return perUnit * units;
    case 'MIXED':
      return Math.round((jobSales * rate) / 100) + perUnit * units;
    default:
      return Math.round((jobSales * rate) / 100);
  }
}

/**
 * 작업 1건 → 기사별 정산 항목. 주기사 정책(policy)으로 배분액을 정하고 2인 작업은 지원율로 나눈다.
 * 반올림 차이는 주기사 몫에 남겨 합계가 배분액과 같게 한다.
 */
export function calcJobShares(job: JobShareInput, policy: CommissionPolicyLike): ShareItem[] {
  const jobSales = Math.max(job.totalAmount - job.extraAmount, 0);
  const pool = poolOf(policy, jobSales, job.units);
  const baseRate = policy.calcType === 'PER_UNIT' ? null : (policy.techShareRate ?? 0);
  const perUnitMemo =
    policy.calcType === 'RATE' ? null : `대당 ${won(policy.perUnitAmount ?? 0)} × ${job.units}대`;
  const supports = [...new Set(job.supportTechnicianIds)].filter((id) => id !== job.mainTechnicianId);
  const supportRate = supports.length ? (policy.supportRoleRate ?? 0) : 0;
  const supportEach = supports.length ? Math.round((pool * supportRate) / 100 / supports.length) : 0;
  const mainPay = pool - supportEach * supports.length;
  const items: ShareItem[] = [
    {
      technicianId: job.mainTechnicianId,
      role: 'MAIN',
      itemType: 'JOB',
      salesAmount: jobSales,
      shareRate: baseRate === null ? null : r2((baseRate * (100 - supportRate)) / 100),
      payAmount: mainPay,
      memo: [perUnitMemo, supports.length ? `2인 작업 주기사 ${100 - supportRate}%` : null].filter(Boolean).join(' · ') || null,
    },
  ];
  for (const id of supports) {
    items.push({
      technicianId: id,
      role: 'SUPPORT',
      itemType: 'JOB',
      salesAmount: jobSales,
      shareRate: baseRate === null ? null : r2((baseRate * supportRate) / 100 / supports.length),
      payAmount: supportEach,
      memo: `2인 작업 지원기사 ${r2(supportRate / supports.length)}%`,
    });
  }
  if (job.extraAmount > 0) {
    const extraRate = policy.extraChargeShareRate ?? 0;
    items.push({
      technicianId: job.mainTechnicianId,
      role: 'MAIN',
      itemType: 'EXTRA',
      salesAmount: job.extraAmount,
      shareRate: extraRate,
      payAmount: Math.round((job.extraAmount * extraRate) / 100),
      memo: null,
    });
  }
  const taken = new Set([job.mainTechnicianId, ...supports]);
  for (const id of new Set(job.accompanyTechnicianIds)) {
    if (taken.has(id)) continue;
    items.push({
      technicianId: id,
      role: 'ACCOMPANY',
      itemType: 'JOB',
      salesAmount: jobSales,
      shareRate: 0,
      payAmount: 0,
      memo: '교육 동행(배분 없음)',
    });
  }
  return items;
}

/* ---------- 정산서 합계 (BR-082·083) ---------- */

export interface ItemLike {
  itemType: string;
  role: string | null;
  workOrderId: number | null;
  salesAmount: number;
  payAmount: number;
}

export interface SettlementTotals {
  jobCount: number;
  grossSales: number;
  basePay: number;
  extraPay: number;
  incentive: number;
  deduction: number;
  cashCollected: number;
  taxableAmount: number;
  withholdingTax: number;
  netPay: number;
}

/** BR-083 도급(FREELANCER) 기사만 사업소득 원천징수. 10원 미만 절사 */
export function withholdingOf(taxable: number, contractType: string, rate: number | null): number {
  if (contractType !== 'FREELANCER' || taxable <= 0 || !rate) return 0;
  return Math.floor((taxable * rate) / 100 / 10) * 10;
}

/**
 * 항목 → 정산서 합계. 관리자 항목의 pay_amount 는 지급액에 더하는 부호 있는 값이다
 * (INCENTIVE +, DEDUCTION −, ADJUST ±). 조정(ADJUST)은 + 면 인센티브, − 면 공제 칸에 더한다.
 */
export function summarizeSettlement(
  items: readonly ItemLike[],
  opts: { cashCollected: number; contractType: string; withholdingRate: number | null },
): SettlementTotals {
  let basePay = 0;
  let extraPay = 0;
  let incentive = 0;
  let deduction = 0;
  let grossSales = 0;
  const jobs = new Set<number>();
  for (const i of items) {
    switch (i.itemType) {
      case 'JOB':
        basePay += i.payAmount;
        if (i.role !== 'ACCOMPANY') {
          grossSales += i.salesAmount;
          if (i.workOrderId !== null) jobs.add(i.workOrderId);
        }
        break;
      case 'EXTRA':
        extraPay += i.payAmount;
        grossSales += i.salesAmount;
        break;
      case 'INCENTIVE':
        incentive += i.payAmount;
        break;
      case 'DEDUCTION':
        deduction += -i.payAmount;
        break;
      case 'ADJUST':
        if (i.payAmount >= 0) incentive += i.payAmount;
        else deduction += -i.payAmount;
        break;
    }
  }
  const taxableAmount = basePay + extraPay + incentive - deduction;
  const withholdingTax = withholdingOf(taxableAmount, opts.contractType, opts.withholdingRate);
  return {
    jobCount: jobs.size,
    grossSales,
    basePay,
    extraPay,
    incentive,
    deduction,
    cashCollected: opts.cashCollected,
    taxableAmount,
    withholdingTax,
    netPay: taxableAmount - withholdingTax - opts.cashCollected,
  };
}

/** 관리자 조정 입력(F-ADM-STL-03) → 항목 pay_amount(부호 있는 값) */
export function manualItemAmount(itemType: ManualItemType, amount: number): number {
  if (itemType === 'INCENTIVE') return Math.abs(amount);
  if (itemType === 'DEDUCTION') return -Math.abs(amount);
  return amount;
}

export function checkAdjustment(i: { itemType: string; amount: number; memo: string }): FieldErrors {
  const e: FieldErrors = {};
  if (!(MANUAL_ITEM_TYPES as readonly string[]).includes(i.itemType)) e.itemType = MSG.required('조정 구분');
  if (!Number.isInteger(i.amount) || i.amount === 0) e.amount = MSG.required('금액');
  else if (i.itemType !== 'ADJUST' && i.amount < 0) e.amount = '금액은 0보다 커야 합니다. 차감은 공제를 고르세요.';
  if (!i.memo.trim()) e.memo = MSG.required('사유');
  return e;
}

/* ---------- 기사 확인·이의 (F-TEC-STL-02) ---------- */

export function checkTechResponse(i: { status: string; action: 'CONFIRM' | 'DISPUTE'; note: string }): FieldErrors {
  if (i.status !== 'CALCULATED')
    return { form: i.status === 'DISPUTED' ? '이미 이의를 제기한 정산입니다. 처리 결과를 기다려 주세요.' : '이미 확인한 정산입니다.' };
  if (i.action === 'DISPUTE' && !i.note.trim()) return { note: MSG.required('이의 내용') };
  return {};
}

/** 관리자 이의 처리(DISPUTED → CONFIRMED): 처리 내용 필수 */
export function checkDisputeResolve(i: { status: string; note: string }): FieldErrors {
  if (i.status !== 'DISPUTED') return { form: '이의 제기된 정산서만 처리할 수 있습니다.' };
  return i.note.trim() ? {} : { note: MSG.required('처리 내용') };
}

/* ---------- 지급 파일 (F-ADM-STL-04) ---------- */

export interface TransferRowInput {
  techCode: string;
  techName: string;
  bankCode: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  netPay: number;
}

/**
 * 은행 대량이체 파일 대상: 실지급액이 0보다 큰 정산서. 계좌가 없으면 파일에서 빼고 따로 알린다.
 * (실지급액이 0 이하 = 현장 수금이 더 많음 → 이체 없음, 회수는 다음 회차 조정으로)
 */
export function splitTransferTargets<T extends TransferRowInput>(rows: readonly T[]) {
  const payable = rows.filter((r) => r.netPay > 0);
  return {
    transfers: payable.filter((r) => r.bankCode && r.bankAccount),
    missingAccount: payable.filter((r) => !r.bankCode || !r.bankAccount),
    nonPositive: rows.filter((r) => r.netPay <= 0),
  };
}
