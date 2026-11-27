import { describe, expect, it } from 'vitest';
import {
  type CampaignRule,
  assertCampaignTransition,
  canTransitionCampaign,
  checkCampaignInput,
  checkCouponInput,
  codeRegisterError,
  couponDiscountOf,
  couponUnusableReason,
  customerCouponState,
  isCampaignDue,
  issuableCount,
  matchesCampaignRule,
  normalizeCouponCode,
  parseCampaignRule,
  rateOf,
} from './coupon-campaign-rules';

const coupon = { discountType: 'FIXED', discountValue: 10000, maxDiscount: null, minOrderAmount: 50000, validFrom: '2026-11-01', validTo: '2026-12-31', targetCategoryId: null };

describe('쿠폰 입력 (F-ADM-CRM-03)', () => {
  const ok = { code: 'WELCOME10', name: '첫 예약 1만원', discountType: 'FIXED', discountValue: 10000, maxDiscount: null, minOrderAmount: 0, validFrom: '2026-11-01', validTo: '2026-12-31', issueLimit: 100 };
  it('정상', () => expect(checkCouponInput(ok)).toEqual({}));
  it('코드 형식·필수·정률 100% 이하·기간 순서·한도', () => {
    expect(checkCouponInput({ ...ok, code: 'ab' }).code).toBeTruthy();
    expect(checkCouponInput({ ...ok, discountType: 'RATE', discountValue: 150 }).discountValue).toBeTruthy();
    expect(checkCouponInput({ ...ok, validTo: null }).validTo).toBeTruthy();
    expect(checkCouponInput({ ...ok, validFrom: '2027-01-01' }).validTo).toBeTruthy();
    expect(checkCouponInput({ ...ok, issueLimit: 0 }).issueLimit).toBeTruthy();
  });
  it('코드는 공백·하이픈을 빼고 대문자로', () => expect(normalizeCouponCode(' wel-come 10 ')).toBe('WELCOME10'));
});

describe('쿠폰 할인 금액 (BR-010 − 쿠폰)', () => {
  it('BR-010 정액은 주문 금액을 넘지 않는다', () => {
    expect(couponDiscountOf(coupon, 90000)).toBe(10000);
    expect(couponDiscountOf(coupon, 5000)).toBe(5000);
  });
  it('BR-010 정률은 원 단위 내림 + 최대 할인', () => {
    expect(couponDiscountOf({ discountType: 'RATE', discountValue: 15, maxDiscount: null }, 99999)).toBe(14999);
    expect(couponDiscountOf({ discountType: 'RATE', discountValue: 15, maxDiscount: 10000 }, 99999)).toBe(10000);
  });
});

describe('쿠폰 사용 가능 여부 (F-CUS-PAY-04)', () => {
  const base = { coupon, customerCouponStatus: 'ISSUED', today: '2026-11-26', orderAmount: 90000, orderCategoryIds: [1] };
  it('조건을 채우면 사용 가능', () => expect(couponUnusableReason(base)).toBeNull());
  it('사용함·기간 만료·시작 전·최소 금액 미달·대상 카테고리 아님', () => {
    expect(couponUnusableReason({ ...base, customerCouponStatus: 'USED' })).toContain('이미');
    expect(couponUnusableReason({ ...base, today: '2027-01-01' })).toContain('기간');
    expect(couponUnusableReason({ ...base, today: '2026-10-01' })).toContain('부터');
    expect(couponUnusableReason({ ...base, orderAmount: 40000 })).toContain('이상');
    expect(couponUnusableReason({ ...base, coupon: { ...coupon, targetCategoryId: 2 } })).toContain('쓸 수 없는');
  });
  it('발급 상태라도 종료일이 지나면 만료로 보인다', () => {
    expect(customerCouponState('ISSUED', '2026-11-25', '2026-11-26')).toBe('EXPIRED');
    expect(customerCouponState('ISSUED', '2026-11-26', '2026-11-26')).toBe('ISSUED');
    expect(customerCouponState('USED', '2026-01-01', '2026-11-26')).toBe('USED');
  });
});

describe('쿠폰 발급 한도·코드 등록 (F-CUS-CPN-01)', () => {
  it('남은 한도 안에서만 발급', () => {
    expect(issuableCount(100, 98, 5)).toBe(2);
    expect(issuableCount(null, 1000, 5)).toBe(5);
    expect(issuableCount(10, 10, 1)).toBe(0);
  });
  it('없는 코드·기간 만료·이미 받음·소진이면 등록 불가', () => {
    const base = { coupon, issueLimit: 10, issuedCount: 0, alreadyHas: false, today: '2026-11-26' };
    expect(codeRegisterError(base)).toBeNull();
    expect(codeRegisterError({ ...base, coupon: null })).toContain('등록할 수 없는');
    expect(codeRegisterError({ ...base, today: '2027-01-01' })).toContain('기간');
    expect(codeRegisterError({ ...base, alreadyHas: true })).toContain('이미');
    expect(codeRegisterError({ ...base, issuedCount: 10 })).toContain('소진');
  });
});

describe('캠페인 상태 (01 §3.16)', () => {
  it('작성 → 예약 → 진행 → 완료, 진행 ⇄ 중지, 완료는 끝', () => {
    expect(canTransitionCampaign('DRAFT', 'SCHEDULED')).toBe(true);
    expect(canTransitionCampaign('SCHEDULED', 'RUNNING')).toBe(true);
    expect(canTransitionCampaign('RUNNING', 'DONE')).toBe(true);
    expect(canTransitionCampaign('RUNNING', 'STOPPED')).toBe(true);
    expect(canTransitionCampaign('STOPPED', 'RUNNING')).toBe(true);
    expect(canTransitionCampaign('DONE', 'RUNNING')).toBe(false);
    expect(() => assertCampaignTransition('DONE', 'DRAFT')).toThrow();
  });
  it('예약 시각이 되면 발송 대상', () => {
    const now = new Date('2026-11-26T10:00:00+09:00');
    expect(isCampaignDue('SCHEDULED', new Date('2026-11-26T09:00:00+09:00'), now)).toBe(true);
    expect(isCampaignDue('SCHEDULED', new Date('2026-11-26T11:00:00+09:00'), now)).toBe(false);
    expect(isCampaignDue('DRAFT', new Date('2026-11-26T09:00:00+09:00'), now)).toBe(false);
  });
});

describe('캠페인 대상 (F-ADM-CRM-02, BR-101)', () => {
  const rule: CampaignRule = { branchIds: [1], deviceTypes: ['STAND'], housingTypes: ['APT'], lastServiceMonthsMin: 6, lastServiceMonthsMax: 24 };
  const c = { status: 'ACTIVE', marketingAgree: true, branchId: 1, deviceTypes: ['WALL', 'STAND'], housingType: 'APT', lastServiceDate: '2026-01-10', alreadyTargeted: false };
  it('모든 조건을 채우면 대상', () => expect(matchesCampaignRule(c, rule, '2026-11-26')).toBe(true));
  it('BR-101 마케팅 동의 철회·휴면·이미 보낸 고객은 제외', () => {
    expect(matchesCampaignRule({ ...c, marketingAgree: false }, rule, '2026-11-26')).toBe(false);
    expect(matchesCampaignRule({ ...c, status: 'DORMANT' }, rule, '2026-11-26')).toBe(false);
    expect(matchesCampaignRule({ ...c, alreadyTargeted: true }, rule, '2026-11-26')).toBe(false);
  });
  it('거점·기기·주거유형·경과 개월이 맞지 않으면 제외', () => {
    expect(matchesCampaignRule({ ...c, branchId: 2 }, rule, '2026-11-26')).toBe(false);
    expect(matchesCampaignRule({ ...c, deviceTypes: ['WALL'] }, rule, '2026-11-26')).toBe(false);
    expect(matchesCampaignRule({ ...c, housingType: 'VILLA' }, rule, '2026-11-26')).toBe(false);
    expect(matchesCampaignRule({ ...c, lastServiceDate: '2026-08-01' }, rule, '2026-11-26')).toBe(false);
    expect(matchesCampaignRule({ ...c, lastServiceDate: '2024-01-01' }, rule, '2026-11-26')).toBe(false);
    expect(matchesCampaignRule({ ...c, lastServiceDate: null }, rule, '2026-11-26')).toBe(false);
  });
  it('조건이 비어 있으면 동의한 활동 고객 전부', () => {
    expect(matchesCampaignRule({ ...c, branchId: null, deviceTypes: [], housingType: null, lastServiceDate: null }, parseCampaignRule({}), '2026-11-26')).toBe(true);
  });
  it('입력 검증: 이름·유형·템플릿 필수, 지난 예약 시각, 개월 범위 순서', () => {
    const now = new Date('2026-11-26T10:00:00+09:00');
    const e = checkCampaignInput({ name: '', campaignType: 'REVISIT_AUTO', templateId: null, sendAt: new Date('2026-11-25T10:00:00+09:00'), now, rule: { ...rule, lastServiceMonthsMin: 30 } });
    expect(Object.keys(e).sort()).toEqual(['campaignType', 'lastServiceMonthsMax', 'name', 'sendAt', 'templateId']);
  });
  it('전환율', () => {
    expect(rateOf(3, 40)).toBe(7.5);
    expect(rateOf(0, 0)).toBeNull();
  });
});
