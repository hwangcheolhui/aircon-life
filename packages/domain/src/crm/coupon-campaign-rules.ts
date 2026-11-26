/**
 * 쿠폰·캠페인 업무 규칙 (단계 9): 쿠폰함(F-CUS-CPN-01)·쿠폰 적용(F-CUS-PAY-04)·쿠폰 관리(F-ADM-CRM-03)·시즌·타겟 캠페인(F-ADM-CRM-02).
 * - BR-010 견적(주문) 금액 = … − 쿠폰. 쿠폰 할인은 주문 항목에 DISCOUNT 1행으로 따로 남긴다(CLAUDE.md §5)
 * - BR-101 마케팅 동의 철회 고객은 캠페인 대상에서 즉시 제외(추출 때마다 다시 확인)
 * 캠페인 상태 전이는 01 §3.16 과 같다. 상태 변경은 반드시 이 함수를 거친다.
 */
import { MSG } from '../messages';
import { addMonthsToDate } from '../ops/ops-rules';

export type FieldErrors = Record<string, string>;

/* ---------- 쿠폰 ---------- */

export const COUPON_DISCOUNT_TYPES = ['FIXED', 'RATE'] as const;
export const CUSTOMER_COUPON_STATUSES = ['ISSUED', 'USED', 'EXPIRED'] as const;
export type CustomerCouponStatus = (typeof CUSTOMER_COUPON_STATUSES)[number];

export interface CouponLike {
  discountType: string;
  discountValue: number;
  maxDiscount: number | null;
  minOrderAmount: number | null;
  validFrom: string | null;
  validTo: string | null;
  targetCategoryId: number | null;
}

/** 쿠폰 코드: 영문 대문자·숫자 4~20자 (공백·하이픈 제거, 대문자로) */
export function normalizeCouponCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}
export const isCouponCode = (code: string) => /^[A-Z0-9]{4,20}$/.test(code);

/** A-CRM-030 쿠폰 입력 검증 */
export function checkCouponInput(i: {
  code: string;
  name: string;
  discountType: string;
  discountValue: number | null;
  maxDiscount: number | null;
  minOrderAmount: number | null;
  validFrom: string | null;
  validTo: string | null;
  issueLimit: number | null;
}): FieldErrors {
  const e: FieldErrors = {};
  if (!isCouponCode(i.code)) e.code = '쿠폰 코드는 영문 대문자·숫자 4~20자입니다.';
  if (!i.name.trim()) e.name = MSG.required('쿠폰명');
  if (!(COUPON_DISCOUNT_TYPES as readonly string[]).includes(i.discountType)) e.discountType = MSG.required('할인 방식');
  const v = i.discountValue;
  if (v === null || !Number.isInteger(v) || v < 1) e.discountValue = MSG.required('할인 값');
  else if (i.discountType === 'RATE' && v > 100) e.discountValue = '할인율은 1~100% 사이여야 합니다.';
  if (i.maxDiscount !== null && (!Number.isInteger(i.maxDiscount) || i.maxDiscount < 1)) e.maxDiscount = '최대 할인 금액은 1원 이상이어야 합니다.';
  if (i.minOrderAmount !== null && (!Number.isInteger(i.minOrderAmount) || i.minOrderAmount < 0)) e.minOrderAmount = '최소 주문 금액은 0원 이상이어야 합니다.';
  if (!i.validTo) e.validTo = MSG.required('사용 종료일');
  if (i.validFrom && i.validTo && i.validFrom > i.validTo) e.validTo = '사용 종료일은 시작일 이후여야 합니다.';
  if (i.issueLimit !== null && (!Number.isInteger(i.issueLimit) || i.issueLimit < 1)) e.issueLimit = '발급 한도는 1장 이상이어야 합니다.';
  return e;
}

/** 할인 금액: 정액은 그대로, 정률은 원 단위 내림 + 최대 할인. 주문 금액을 넘지 않는다 */
export function couponDiscountOf(c: Pick<CouponLike, 'discountType' | 'discountValue' | 'maxDiscount'>, orderAmount: number): number {
  if (orderAmount <= 0) return 0;
  let d = c.discountType === 'RATE' ? Math.floor((orderAmount * c.discountValue) / 100) : c.discountValue;
  if (c.maxDiscount !== null && c.maxDiscount > 0) d = Math.min(d, c.maxDiscount);
  return Math.max(0, Math.min(d, orderAmount));
}

/** 고객 쿠폰 표시 상태: 발급 상태라도 사용 기간이 지났으면 만료 */
export function customerCouponState(status: string, validTo: string | null, today: string): CustomerCouponStatus {
  if (status === 'USED') return 'USED';
  if (status === 'EXPIRED' || (validTo !== null && validTo < today)) return 'EXPIRED';
  return 'ISSUED';
}

/** F-CUS-PAY-04 이 주문에 쓸 수 있는지(못 쓰면 사유) */
export function couponUnusableReason(i: {
  coupon: CouponLike;
  customerCouponStatus: string;
  today: string;
  orderAmount: number;
  orderCategoryIds: readonly number[];
}): string | null {
  const s = customerCouponState(i.customerCouponStatus, i.coupon.validTo, i.today);
  if (s === 'USED') return '이미 사용한 쿠폰입니다.';
  if (s === 'EXPIRED') return '사용 기간이 지난 쿠폰입니다.';
  if (i.coupon.validFrom && i.coupon.validFrom > i.today) return `${i.coupon.validFrom}부터 쓸 수 있는 쿠폰입니다.`;
  if (i.coupon.minOrderAmount && i.orderAmount < i.coupon.minOrderAmount)
    return `${i.coupon.minOrderAmount.toLocaleString('ko-KR')}원 이상 주문에 쓸 수 있어요.`;
  if (i.coupon.targetCategoryId && !i.orderCategoryIds.includes(i.coupon.targetCategoryId)) return '이 서비스에는 쓸 수 없는 쿠폰입니다.';
  return null;
}

/** 발급 한도 확인: 남은 수량 안에서만 발급 */
export function issuableCount(issueLimit: number | null, issuedCount: number, wanted: number): number {
  if (issueLimit === null) return wanted;
  return Math.max(0, Math.min(wanted, issueLimit - issuedCount));
}

/** 코드 등록(F-CUS-CPN-01): 사용 기간 안이고 한도가 남았고 아직 받지 않은 쿠폰만 */
export function codeRegisterError(i: { coupon: CouponLike | null; issueLimit: number | null; issuedCount: number; alreadyHas: boolean; today: string }): string | null {
  if (!i.coupon) return '등록할 수 없는 쿠폰 코드입니다.';
  if (i.coupon.validTo && i.coupon.validTo < i.today) return '사용 기간이 지난 쿠폰입니다.';
  if (i.alreadyHas) return '이미 받은 쿠폰입니다.';
  if (issuableCount(i.issueLimit, i.issuedCount, 1) < 1) return '쿠폰이 모두 소진되었습니다.';
  return null;
}

/* ---------- 캠페인 (F-ADM-CRM-02) ---------- */

export const CAMPAIGN_STATUSES = ['DRAFT', 'SCHEDULED', 'RUNNING', 'DONE', 'STOPPED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
/** 01 §3.16 캠페인 상태 전이 (자동 재방문은 RUNNING ⇄ STOPPED) */
export const CAMPAIGN_TRANSITIONS: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  DRAFT: ['SCHEDULED', 'RUNNING', 'STOPPED'],
  SCHEDULED: ['DRAFT', 'RUNNING', 'STOPPED'],
  RUNNING: ['DONE', 'STOPPED'],
  STOPPED: ['RUNNING', 'DRAFT'],
  DONE: [],
};
export function canTransitionCampaign(from: string, to: CampaignStatus): boolean {
  return (CAMPAIGN_TRANSITIONS[from as CampaignStatus] ?? []).includes(to);
}
export function assertCampaignTransition(from: string, to: CampaignStatus): void {
  if (!canTransitionCampaign(from, to)) throw new Error(`캠페인 상태를 ${from}에서 ${to}(으)로 바꿀 수 없습니다.`);
}

/** 대상 조건 (campaign.target_rule_json) */
export interface CampaignRule {
  branchIds: number[];
  deviceTypes: string[];
  housingTypes: string[];
  /** 최근 작업 후 최소 경과 개월(이상) */
  lastServiceMonthsMin: number | null;
  /** 최근 작업 후 최대 경과 개월(이하) */
  lastServiceMonthsMax: number | null;
}

export const SEND_CAMPAIGN_TYPES = ['SEASON', 'WINBACK', 'CROSS_SELL'] as const;

export function parseCampaignRule(v: unknown): CampaignRule {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const nums = (x: unknown) => (Array.isArray(x) ? x.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.length > 0) : []);
  const opt = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null);
  return {
    branchIds: nums(o.branchIds),
    deviceTypes: strs(o.deviceTypes),
    housingTypes: strs(o.housingTypes),
    lastServiceMonthsMin: opt(o.lastServiceMonthsMin),
    lastServiceMonthsMax: opt(o.lastServiceMonthsMax),
  };
}

/** A-CRM-020 캠페인 입력 검증 */
export function checkCampaignInput(i: {
  name: string;
  campaignType: string;
  templateId: number | null;
  sendAt: Date | null;
  now: Date;
  rule: CampaignRule;
}): FieldErrors {
  const e: FieldErrors = {};
  if (!i.name.trim()) e.name = MSG.required('캠페인명');
  if (!(SEND_CAMPAIGN_TYPES as readonly string[]).includes(i.campaignType)) e.campaignType = MSG.required('캠페인 유형');
  if (!i.templateId) e.templateId = MSG.required('발송 템플릿');
  if (i.sendAt && i.sendAt.getTime() < i.now.getTime() - 60_000) e.sendAt = '예약 발송 시각은 지금 이후여야 합니다.';
  const { lastServiceMonthsMin: a, lastServiceMonthsMax: b } = i.rule;
  if (a !== null && b !== null && a > b) e.lastServiceMonthsMax = '최대 경과 개월은 최소 경과 개월보다 커야 합니다.';
  return e;
}

/**
 * 캠페인 대상 판정: 활동 + 마케팅 동의(BR-101) + 조건(거점·기기·주거유형·최근 작업 경과 개월) + 이 캠페인 미발송.
 * 조건 목록이 비어 있으면 그 조건은 따지지 않는다.
 */
export function matchesCampaignRule(
  c: {
    status: string;
    marketingAgree: boolean;
    branchId: number | null;
    deviceTypes: readonly string[];
    housingType: string | null;
    lastServiceDate: string | null;
    alreadyTargeted: boolean;
  },
  rule: CampaignRule,
  today: string,
): boolean {
  if (c.status !== 'ACTIVE' || !c.marketingAgree || c.alreadyTargeted) return false;
  if (rule.branchIds.length && (c.branchId === null || !rule.branchIds.includes(c.branchId))) return false;
  if (rule.deviceTypes.length && !c.deviceTypes.some((t) => rule.deviceTypes.includes(t))) return false;
  if (rule.housingTypes.length && (!c.housingType || !rule.housingTypes.includes(c.housingType))) return false;
  if (rule.lastServiceMonthsMin !== null || rule.lastServiceMonthsMax !== null) {
    if (!c.lastServiceDate) return false;
    if (rule.lastServiceMonthsMin !== null && c.lastServiceDate > addMonthsToDate(today, -rule.lastServiceMonthsMin)) return false;
    if (rule.lastServiceMonthsMax !== null && c.lastServiceDate < addMonthsToDate(today, -rule.lastServiceMonthsMax)) return false;
  }
  return true;
}

/** 예약 발송 시각이 됐는지 (SCHEDULED + send_at ≤ now) */
export const isCampaignDue = (status: string, sendAt: Date | null, now: Date) => status === 'SCHEDULED' && sendAt !== null && sendAt.getTime() <= now.getTime();

/** 전환율(%) 소수 첫째 자리 */
export function rateOf(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}
