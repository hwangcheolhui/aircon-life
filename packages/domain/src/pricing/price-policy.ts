/**
 * 가격 정책 선택 (BR-010 "단가는 우선순위가 가장 높은 유효 price_policy").
 * 단계 0에서는 A-PRD-020 "적용 예정 가격 미리보기"(F-ADM-PRD-02)에 쓰고,
 * 단계 1 견적 계산(공용 견적 모듈)에서 그대로 재사용한다.
 */

export type CustomerType = 'PERSONAL' | 'BUSINESS';

export interface PricePolicyLike {
  id: number;
  productId: number;
  branchId: number | null;
  customerType: CustomerType | null;
  unitPrice: number;
  validFrom: string; // YYYY-MM-DD
  validTo: string | null;
  priority: number;
}

export interface PriceQuery {
  productId: number;
  branchId: number | null;
  customerType: CustomerType | null;
  date: string; // YYYY-MM-DD (방문/적용 기준일)
}

export function isPolicyApplicable(p: PricePolicyLike, q: PriceQuery): boolean {
  if (p.productId !== q.productId) return false;
  if (p.validFrom > q.date) return false;
  if (p.validTo !== null && p.validTo < q.date) return false;
  if (p.branchId !== null && p.branchId !== q.branchId) return false;
  if (p.customerType !== null && p.customerType !== q.customerType) return false;
  return true;
}

/**
 * 유효 정책 중 하나를 고른다.
 * 1) priority 큰 것 → 2) 거점 지정 > 전 거점 공통 → 3) 고객유형 지정 > 공통 → 4) valid_from 최신 → 5) id 큰 것
 * (2~5는 priority가 같을 때의 결정 규칙. ERD §2.3.3 비고에 기록)
 */
export function selectPricePolicy<T extends PricePolicyLike>(policies: readonly T[], q: PriceQuery): T | null {
  const candidates = policies.filter((p) => isPolicyApplicable(p, q));
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const ab = a.branchId === null ? 0 : 1;
    const bb = b.branchId === null ? 0 : 1;
    if (ab !== bb) return bb - ab;
    const ac = a.customerType === null ? 0 : 1;
    const bc = b.customerType === null ? 0 : 1;
    if (ac !== bc) return bc - ac;
    if (a.validFrom !== b.validFrom) return a.validFrom < b.validFrom ? 1 : -1;
    return b.id - a.id;
  })[0]!;
}

export interface MultiUnitDiscountTier {
  min: number;
  rate: number;
}

/** 대수 할인 규칙 검증 (price_policy.multi_unit_discount_json). 오류 문구 또는 null */
export function validateDiscountTiers(tiers: readonly MultiUnitDiscountTier[]): string | null {
  let prevMin = 1;
  let prevRate = 0;
  for (const t of tiers) {
    if (!Number.isInteger(t.min) || t.min < 2) return '대수 할인의 최소 대수는 2 이상 정수여야 합니다.';
    if (t.rate <= 0 || t.rate >= 100) return '대수 할인율은 0보다 크고 100보다 작아야 합니다.';
    if (t.min <= prevMin) return '대수 할인은 최소 대수 오름차순으로 입력해야 합니다.';
    if (t.rate < prevRate) return '대수가 많을수록 할인율이 같거나 커야 합니다.';
    prevMin = t.min;
    prevRate = t.rate;
  }
  return null;
}
