import { describe, expect, it } from 'vitest';
import { type PricePolicyLike, selectPricePolicy, validateDiscountTiers } from './price-policy';

const base: PricePolicyLike = {
  id: 1,
  productId: 10,
  branchId: null,
  customerType: null,
  unitPrice: 90000,
  validFrom: '2027-01-01',
  validTo: null,
  priority: 0,
};
const q = { productId: 10, branchId: 1, customerType: 'PERSONAL' as const, date: '2027-03-01' };

describe('BR-010 단가는 우선순위가 가장 높은 유효 가격 정책', () => {
  it('BR-010 우선순위가 높은 정책을 고른다', () => {
    const p = selectPricePolicy([base, { ...base, id: 2, unitPrice: 80000, priority: 5 }], q);
    expect(p?.id).toBe(2);
  });

  it('BR-010 기간이 지났거나 시작 전인 정책은 제외한다', () => {
    const expired = { ...base, id: 2, priority: 9, validTo: '2027-02-28' };
    const future = { ...base, id: 3, priority: 9, validFrom: '2027-04-01' };
    expect(selectPricePolicy([base, expired, future], q)?.id).toBe(1);
  });

  it('BR-010 다른 거점·다른 고객유형 전용 정책은 제외한다', () => {
    const other = { ...base, id: 2, priority: 9, branchId: 2 };
    const biz = { ...base, id: 3, priority: 9, customerType: 'BUSINESS' as const };
    expect(selectPricePolicy([base, other, biz], q)?.id).toBe(1);
  });

  it('BR-010 우선순위가 같으면 거점 지정 정책이 공통 정책보다 앞선다', () => {
    const own = { ...base, id: 2, branchId: 1, unitPrice: 85000 };
    expect(selectPricePolicy([base, own], q)?.id).toBe(2);
  });

  it('BR-010 예외: 유효한 정책이 없으면 null', () => {
    expect(selectPricePolicy([base], { ...q, productId: 99 })).toBeNull();
  });
});

describe('대수 할인 규칙 검증', () => {
  it('정상 규칙은 통과한다', () => {
    expect(validateDiscountTiers([{ min: 2, rate: 5 }, { min: 3, rate: 10 }])).toBeNull();
  });
  it('최소 대수 1, 내림차순, 할인율 범위 오류를 잡는다', () => {
    expect(validateDiscountTiers([{ min: 1, rate: 5 }])).not.toBeNull();
    expect(validateDiscountTiers([{ min: 3, rate: 5 }, { min: 2, rate: 10 }])).not.toBeNull();
    expect(validateDiscountTiers([{ min: 2, rate: 100 }])).not.toBeNull();
    expect(validateDiscountTiers([{ min: 2, rate: 10 }, { min: 3, rate: 5 }])).not.toBeNull();
  });
});
