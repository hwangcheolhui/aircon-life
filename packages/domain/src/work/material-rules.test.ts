import { describe, expect, it } from 'vitest';
import { checkExtraChargeInput } from './extra-charge';
import { checkMaterialUsage, materialChargeTitle, materialCostOf, materialSaleAmount } from './material-rules';

describe('자재 사용 입력 (F-TEC-WRK-06)', () => {
  const ok = { materialFound: true, materialActive: true, quantity: 2, chargeToCustomer: true, salePrice: 5000 };
  it('정상', () => expect(checkMaterialUsage(ok)).toEqual({}));
  it('자재 필수·사용 중지·수량 범위·판매가 없는 자재 청구 불가', () => {
    expect(checkMaterialUsage({ ...ok, materialFound: false }).materialId).toBeTruthy();
    expect(checkMaterialUsage({ ...ok, materialActive: false }).materialId).toBeTruthy();
    expect(checkMaterialUsage({ ...ok, quantity: 0 }).quantity).toBeTruthy();
    expect(checkMaterialUsage({ ...ok, quantity: 100 }).quantity).toBeTruthy();
    expect(checkMaterialUsage({ ...ok, salePrice: 0 }).chargeToCustomer).toBeTruthy();
    expect(checkMaterialUsage({ ...ok, salePrice: 0, chargeToCustomer: false })).toEqual({});
  });
  it('청구 금액은 판매가 × 수량, 청구하지 않으면 0', () => {
    expect(materialSaleAmount(5000, 3, true)).toBe(15000);
    expect(materialSaleAmount(5000, 3, false)).toBe(0);
  });
  it('자재원가 합계(KPI 마진율)', () => expect(materialCostOf([{ unitCost: 1000, quantity: 2 }, { unitCost: 300, quantity: 5 }])).toBe(3500));
  it('항목명', () => expect(materialChargeTitle('배수 호스', 2)).toBe('자재: 배수 호스 × 2'));
  it('BR-040 청구 자재는 자재 추가요금으로 동의를 받고, 마스터 판매가라 증빙 사진 없이 등록된다', () => {
    const e = checkExtraChargeInput({ chargeType: 'MATERIAL', title: '자재: 배수 호스 × 2', amount: 10000, reason: '자재 사용', hasEvidence: false, hasRule: false, quantity: 1, fromMaterialMaster: true });
    expect(e).toEqual({});
    const e2 = checkExtraChargeInput({ chargeType: 'MATERIAL', title: '자재 구매', amount: 10000, reason: '현장 구매', hasEvidence: false, hasRule: false, quantity: 1 });
    expect(e2.evidence).toBeTruthy();
  });
});
