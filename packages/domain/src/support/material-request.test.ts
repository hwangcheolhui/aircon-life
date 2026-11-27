import { describe, expect, it } from 'vitest';
import {
  assertMaterialRequestTransition,
  canTransitionMaterialRequest,
  checkMaterialRequest,
  isBelowSafetyStock,
  materialsDueOn,
  nextStockQuantity,
  todayMaterials,
} from './material-request';

describe('자재 요청 상태 (01 §3.19)', () => {
  it('요청 → 이동중 → 수령, 요청 → 취소', () => {
    expect(canTransitionMaterialRequest('REQUESTED', 'SHIPPED')).toBe(true);
    expect(canTransitionMaterialRequest('SHIPPED', 'RECEIVED')).toBe(true);
    expect(canTransitionMaterialRequest('REQUESTED', 'CANCELED')).toBe(true);
  });
  it('거점에서 바로 받은 요청은 요청에서 수령 가능', () => expect(canTransitionMaterialRequest('REQUESTED', 'RECEIVED')).toBe(true));
  it('이동중·수령 건은 취소할 수 없다', () => {
    expect(canTransitionMaterialRequest('SHIPPED', 'CANCELED')).toBe(false);
    expect(() => assertMaterialRequestTransition('RECEIVED', 'CANCELED')).toThrow();
  });
});

describe('자재 요청 입력 (F-TEC-MAT-02)', () => {
  const ok = { materialActive: true, quantity: 3, neededDate: '2026-11-28', today: '2026-11-27' };
  it('정상 입력', () => expect(checkMaterialRequest(ok)).toBeNull());
  it('자재 미선택·수량 범위·지난 필요일을 막는다', () => {
    const e = checkMaterialRequest({ materialActive: null, quantity: 0, neededDate: '2026-11-26', today: '2026-11-27' });
    expect(e?.materialId).toBe('자재는 필수 입력값입니다.');
    expect(e?.quantity).toBeDefined();
    expect(e?.neededDate).toBeDefined();
  });
  it('사용 중지 자재는 요청할 수 없다', () => expect(checkMaterialRequest({ ...ok, materialActive: false })?.materialId).toBeDefined());
});

describe('보유 자재 (F-TEC-MAT-01)', () => {
  it('안전재고보다 적으면 미달, 안전재고 0이면 표시 안 함', () => {
    expect(isBelowSafetyStock(2, 5)).toBe(true);
    expect(isBelowSafetyStock(5, 5)).toBe(false);
    expect(isBelowSafetyStock(0, 0)).toBe(false);
  });
  it('사용으로 0 아래로 내려가지 않는다', () => {
    expect(nextStockQuantity(2, -5)).toBe(0);
    expect(nextStockQuantity(2, 3)).toBe(5);
  });
});

describe('오늘의 자재·날짜별 자재 (F-TEC-HOM-02·03)', () => {
  const rows = [
    { id: 1, status: 'SHIPPED', neededDate: '2026-11-28' },
    { id: 2, status: 'REQUESTED', neededDate: '2026-11-27' },
    { id: 3, status: 'REQUESTED', neededDate: '2026-11-29' },
    { id: 4, status: 'RECEIVED', neededDate: '2026-11-27' },
    { id: 5, status: 'REQUESTED', neededDate: '2026-11-25' },
  ];
  it('오늘 = 이동중 전부 + 필요일이 오늘까지인 미수령', () => expect(todayMaterials(rows, '2026-11-27').map((r) => r.id)).toEqual([1, 2, 5]));
  it('앞날 = 그날 필요한 요청만', () => {
    expect(materialsDueOn(rows, '2026-11-29', '2026-11-27').map((r) => r.id)).toEqual([3]);
    expect(materialsDueOn(rows, '2026-11-28', '2026-11-27')).toEqual([]);
  });
});
