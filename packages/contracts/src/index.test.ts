import { describe, expect, it } from 'vitest';
import { branchInput, fieldErrors, pricePolicyInput, surchargeRuleInput } from './index';

describe('입력 스키마', () => {
  it('필수 누락 시 "○○은(는) 필수 입력값입니다." 문구를 낸다', () => {
    const r = branchInput.safeParse({ branchCode: '', name: '', status: 'ACTIVE' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const e = fieldErrors(r.error);
      expect(e.branchCode).toBe('거점 코드는 필수 입력값입니다.');
      expect(e.name).toBe('거점명은 필수 입력값입니다.');
    }
  });

  it('폼 문자열을 숫자·null로 바꾼다', () => {
    const r = branchInput.parse({ branchCode: 'EP01', name: '은평거점', status: 'ACTIVE', radiusKm: '5.0', phone: '' });
    expect(r.phone).toBeNull();
    expect(r.radiusKm).toBe('5.0');
  });

  it('대수 할인 JSON을 검증한다', () => {
    const base = { productId: '1', unitPrice: '90000', validFrom: '2027-01-01', priority: '0' };
    expect(pricePolicyInput.safeParse({ ...base, multiUnitDiscountJson: '[{"min":2,"rate":5}]' }).success).toBe(true);
    expect(pricePolicyInput.safeParse({ ...base, multiUnitDiscountJson: '[{"min":1,"rate":5}]' }).success).toBe(false);
    expect(pricePolicyInput.safeParse({ ...base, multiUnitDiscountJson: '{bad' }).success).toBe(false);
    expect(pricePolicyInput.safeParse({ ...base, validTo: '2026-12-31' }).success).toBe(false);
  });

  it('정률 할증은 100%를 넘을 수 없다', () => {
    const r = surchargeRuleInput.safeParse({ ruleCode: 'NIGHT', name: '야간', applyType: 'AUTO_QUOTE', amountType: 'RATE', amount: '150' });
    expect(r.success).toBe(false);
  });
});
