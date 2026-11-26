/**
 * 자재 사용 (F-TEC-WRK-06, T-WRK-050, 01 §2.9.5, 단계 9).
 * - 자재 마스터의 원가(unit_cost)·판매가(sale_price)를 사용 시점 값으로 남긴다(BR-014와 같은 스냅샷 원칙)
 * - 고객 청구 자재는 추가요금(MATERIAL)으로 함께 등록해 고객 동의를 받은 금액만 청구한다(BR-040). 판매가가 사전 공개 단가라 증빙 사진은 받지 않는다
 * - 원가 합계는 KPI 마진율의 자재원가(ERD §5)
 */
import { MSG } from '../messages';

import type { FieldErrors } from '../payment/payment-rules';

export const MATERIAL_QTY_MAX = 99;

export function checkMaterialUsage(i: { materialFound: boolean; materialActive: boolean; quantity: number | null; chargeToCustomer: boolean; salePrice: number }): FieldErrors {
  const e: FieldErrors = {};
  if (!i.materialFound) e.materialId = MSG.required('자재');
  else if (!i.materialActive) e.materialId = '사용 중지된 자재입니다.';
  if (i.quantity === null || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > MATERIAL_QTY_MAX) e.quantity = `수량은 1~${MATERIAL_QTY_MAX} 사이로 입력해 주세요.`;
  if (i.chargeToCustomer && i.salePrice < 1) e.chargeToCustomer = '판매가가 없는 자재는 고객에게 청구할 수 없습니다.';
  return e;
}

/** 고객 청구 금액 = 판매가 × 수량 (청구하지 않으면 0) */
export const materialSaleAmount = (salePrice: number, quantity: number, chargeToCustomer: boolean) => (chargeToCustomer ? salePrice * quantity : 0);

/** 자재원가 합계 = Σ 원가 × 수량 */
export const materialCostOf = (rows: readonly { unitCost: number; quantity: number }[]) => rows.reduce((s, r) => s + r.unitCost * r.quantity, 0);

/** 청구 자재 추가요금 항목명 */
export const materialChargeTitle = (name: string, quantity: number) => `자재: ${name} × ${quantity}`.slice(0, 100);
