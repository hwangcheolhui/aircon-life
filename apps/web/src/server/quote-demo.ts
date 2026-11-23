import 'server-only';
/**
 * 견적 체험 모드 (DB 미연결 전용, 구현 기간 한정). 관리자 "DB 미연결" 열람 모드와 같은 취지로,
 * DATABASE_URL 이 없을 때만 예시 관할 지역·예시 상품·예시 가격으로 견적 흐름(C-QUO-010~040)을 끝까지 시험할 수 있게 한다.
 * - 견적은 저장하지 않는다(결과 화면은 입력값으로 다시 계산).
 * - DB를 연결하면 자동으로 꺼지고, 관리자 화면에 등록한 실제 관할 지역·상품·가격만 쓴다.
 * - 계산은 실제와 같은 공용 견적 모듈(calculateQuote)을 거친다.
 * 아래 값은 운영 기준값이 아니라 시연용 예시다. 실제 기준값은 A-DSP-050·A-PRD-011·020·030·040에서 등록한다.
 */
import { HOLIDAY_SEED } from '@aircon/db';
import type { QuoteCatalog, ServiceAreaLike } from '@aircon/domain';
import { isDbConfigured } from './db';

export const isQuoteDemoMode = () => !isDbConfigured();

/**
 * 체험 모드에서 서비스 가능으로 보는 지역: 법정동 코드 앞자리(시군구 5자리 또는 법정동 10자리).
 * QUOTE_DEMO_AREA_CODES(쉼표 구분)로 바꿀 수 있고, 없으면 예시 거점(은평) 관할인 서울 은평구(11380).
 */
export function demoAreaPrefixes(): string[] {
  const raw = process.env.QUOTE_DEMO_AREA_CODES ?? '11380';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{2,10}$/.test(s));
}

export const DEMO_BRANCH_ID = 0;

export function demoServiceArea(legalDongCode: string): ServiceAreaLike | null {
  const ok = demoAreaPrefixes().some((p) => legalDongCode.startsWith(p));
  return ok ? { legalDongCode, branchId: DEMO_BRANCH_ID, isServiceable: true, travelFee: 0 } : null;
}

const tiers = [
  { min: 2, rate: 5 },
  { min: 3, rate: 10 },
];
const product = (
  id: number,
  productCode: string,
  name: string,
  deviceType: string,
  cleanLevel: string,
  baseDurationMin: number,
) => ({
  id,
  productCode,
  name,
  deviceType,
  cleanLevel,
  baseDurationMin,
  includedItems: cleanLevel === 'FULL' ? '필터·열교환기·송풍팬·드레인판 분해 세척' : '필터·열교환기 세척',
  excludedItems: '실외기 세척(옵션), 배관 교체·수리',
});
const price = (id: number, productId: number, unitPrice: number) => ({
  id,
  productId,
  branchId: null,
  customerType: null,
  unitPrice,
  validFrom: '2026-01-01',
  validTo: null,
  priority: 0,
  multiUnitDiscountJson: tiers,
});

export const DEMO_QUOTE_CATALOG: QuoteCatalog = {
  products: [
    product(1, 'AC-WALL-BASIC', '벽걸이 일반 세척', 'WALL', 'BASIC', 60),
    product(2, 'AC-WALL-FULL', '벽걸이 완전분해 세척', 'WALL', 'FULL', 90),
    product(3, 'AC-STAND-FULL', '스탠드 완전분해 세척', 'STAND', 'FULL', 120),
    product(4, 'AC-2IN1-FULL', '2in1 완전분해 세척', 'TWO_IN_ONE', 'FULL', 180),
    product(5, 'AC-CEIL4-FULL', '천장형 4way 완전분해 세척', 'CEILING_4WAY', 'FULL', 120),
  ],
  policies: [
    price(11, 1, 70000),
    price(12, 2, 90000),
    price(13, 3, 130000),
    price(14, 4, 200000),
    price(15, 5, 150000),
  ],
  options: [
    { id: 21, productId: null, optionCode: 'OUTDOOR', name: '실외기 세척', price: 30000, durationMin: 30 },
  ],
  surchargeRules: [
    {
      id: 31,
      ruleCode: 'NIGHT',
      name: '야간 방문 할증',
      applyType: 'AUTO_QUOTE',
      conditionJson: { weekday: true, after: '18:00' },
      amountType: 'FIXED',
      amount: 30000,
      perUnit: false,
      customerNotice: null,
    },
    {
      id: 32,
      ruleCode: 'HOLIDAY',
      name: '휴일 방문 할증',
      applyType: 'AUTO_QUOTE',
      conditionJson: { weekend: true, holiday: true },
      amountType: 'FIXED',
      amount: 30000,
      perUnit: false,
      customerNotice: null,
    },
    {
      id: 34,
      ruleCode: 'HEAVY_DIRT',
      name: '오염 심함',
      applyType: 'ON_SITE',
      conditionJson: null,
      amountType: 'FIXED',
      amount: 20000,
      perUnit: true,
      customerNotice: '곰팡이·오염이 심하면 대당 추가될 수 있어요',
    },
    {
      id: 35,
      ruleCode: 'HIGH_PLACE',
      name: '고소작업',
      applyType: 'ON_SITE',
      conditionJson: null,
      amountType: 'FIXED',
      amount: 30000,
      perUnit: false,
      customerNotice: '사다리 이상 높은 곳 설치 시',
    },
  ],
};

export const DEMO_HOLIDAYS: readonly string[] = HOLIDAY_SEED.map((h) => h.holidayDate);

/** 체험 모드 결과 화면 주소: 견적을 저장하지 않으므로 입력값을 주소에 담는다 */
export const DEMO_QUOTE_NO = 'demo';
export const encodeDemoRequest = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
export function decodeDemoRequest(s: string | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
