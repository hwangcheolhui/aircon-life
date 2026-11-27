/**
 * 기사 자재 규칙 (단계 10, F-TEC-MAT-01·02 · F-TEC-HOM-02·03, 01 §2.9.6·2.9.7 · §3.19).
 * 상태: 요청(REQUESTED) → 이동중(SHIPPED, 거점 불출 A-TEC-060 단계 11) → 수령(RECEIVED) / 요청에서 취소(CANCELED).
 * 거점 불출 화면이 생기기 전에는 기사가 거점에서 직접 받은 경우 요청 상태에서 바로 [수령 확인]을 누를 수 있다.
 * 수령하면 기사 보유 자재(technician_material_stock)가 늘고, 현장 자재 사용(T-WRK-050)을 입력하면 줄어든다(0 아래로는 내려가지 않음).
 */
import { MSG } from '../messages';

export const MATERIAL_REQUEST_STATUSES = ['REQUESTED', 'SHIPPED', 'RECEIVED', 'CANCELED'] as const;
export type MaterialRequestStatus = (typeof MATERIAL_REQUEST_STATUSES)[number];

/** 01 §3.19 전이표. SHIPPED 는 관리자 불출(단계 11)만, RECEIVED·CANCELED 는 기사 */
export const MATERIAL_REQUEST_TRANSITIONS: Readonly<Record<MaterialRequestStatus, readonly MaterialRequestStatus[]>> = {
  REQUESTED: ['SHIPPED', 'RECEIVED', 'CANCELED'],
  SHIPPED: ['RECEIVED'],
  RECEIVED: [],
  CANCELED: [],
};

export const canTransitionMaterialRequest = (from: string, to: MaterialRequestStatus) =>
  (MATERIAL_REQUEST_TRANSITIONS[from as MaterialRequestStatus] ?? []).includes(to);

export function assertMaterialRequestTransition(from: string, to: MaterialRequestStatus) {
  if (!canTransitionMaterialRequest(from, to)) throw new Error(`자재 요청 상태를 ${from}에서 ${to}(으)로 바꿀 수 없습니다.`);
}

/** 한 번에 요청할 수 있는 최대 수량 (material_usage 와 같은 1~99) */
export const MATERIAL_REQUEST_MAX_QTY = 99;

/** 자재 요청 입력 검증 (T-MAT-020) */
export function checkMaterialRequest(i: { materialActive: boolean | null; quantity: number; neededDate: string; today: string }): Record<string, string> | null {
  const e: Record<string, string> = {};
  if (i.materialActive === null) e.materialId = MSG.required('자재');
  else if (!i.materialActive) e.materialId = '지금은 요청할 수 없는 자재입니다.';
  if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > MATERIAL_REQUEST_MAX_QTY) e.quantity = `수량은 1~${MATERIAL_REQUEST_MAX_QTY} 사이로 입력해 주세요.`;
  if (!i.neededDate) e.neededDate = MSG.required('필요일');
  else if (i.neededDate < i.today) e.neededDate = '필요일은 오늘 이후로 정해 주세요.';
  return Object.keys(e).length ? e : null;
}

/** 안전재고 미달: 안전재고가 정해져 있고(>0) 보유 수량이 그보다 적을 때 */
export const isBelowSafetyStock = (quantity: number, safetyStock: number) => safetyStock > 0 && quantity < safetyStock;

/** 수령·사용 뒤 보유 수량 (0 아래로 내려가지 않음) */
export const nextStockQuantity = (current: number, delta: number) => Math.max(0, current + delta);

/** 아직 받지 않은 요청 (요청·이동중) */
export const isOpenMaterialRequest = (status: string) => status === 'REQUESTED' || status === 'SHIPPED';

/**
 * 오늘의 자재 (F-TEC-HOM-02 "D-1 이동중 자재"): 이동중인 자재 전부 + 필요일이 오늘까지인 아직 받지 않은 요청.
 * 주간 할일(F-TEC-HOM-03)의 날짜별 자재 건수는 materialsDueOn 으로 센다.
 */
export function todayMaterials<T extends { status: string; neededDate: string | null }>(rows: readonly T[], today: string): T[] {
  return rows.filter((r) => r.status === 'SHIPPED' || (r.status === 'REQUESTED' && r.neededDate !== null && r.neededDate <= today));
}

/** 그날 필요한 아직 받지 않은 자재 요청 (오늘이면 지난 필요일·이동중 포함) */
export function materialsDueOn<T extends { status: string; neededDate: string | null }>(rows: readonly T[], date: string, today: string): T[] {
  if (date === today) return todayMaterials(rows, today);
  return rows.filter((r) => isOpenMaterialRequest(r.status) && r.status !== 'SHIPPED' && r.neededDate === date);
}
