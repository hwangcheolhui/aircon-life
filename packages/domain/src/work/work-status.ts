/**
 * 작업 상태 전이 (01 §3.2 `work_order.status`). 작업 상태 변경은 반드시 이 전이표를 거치고,
 * 주문 상태는 orderStatusForWork 로 같이 맞춘다(주문 쪽은 order-status 전이표 + order_status_history 1행).
 */
import type { OrderStatus } from '../order/order-status';

export const WORK_STATUSES = ['READY', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'DONE', 'PENDING', 'CANCELED'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

/** 01 §3.2: READY → ON_THE_WAY → ARRIVED → IN_PROGRESS → DONE / 분기 PENDING·CANCELED. 재약속(PENDING → 주문 ASSIGNED)이면 같은 작업 건을 READY로 되돌린다 */
export const WORK_TRANSITIONS: Readonly<Record<WorkStatus, readonly WorkStatus[]>> = {
  READY: ['ON_THE_WAY', 'PENDING', 'CANCELED'],
  ON_THE_WAY: ['ARRIVED', 'PENDING'],
  ARRIVED: ['IN_PROGRESS', 'PENDING'],
  IN_PROGRESS: ['DONE', 'PENDING'],
  DONE: [],
  PENDING: ['READY', 'CANCELED'],
  CANCELED: [],
};

/** 진행 중(출발~작업중) 작업: 기사 앱 "진행 중 작업" 고정 배너, 한 기사에 동시에 1건만 */
export const ACTIVE_WORK_STATUSES: readonly WorkStatus[] = ['ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'];

export function canTransitionWork(from: string | null, to: WorkStatus): boolean {
  if (from === null) return to === 'READY';
  return (WORK_TRANSITIONS[from as WorkStatus] ?? []).includes(to);
}

export function assertWorkTransition(from: string | null, to: WorkStatus): void {
  if (!canTransitionWork(from, to)) throw new Error(`작업 상태를 ${from ?? '(신규)'}에서 ${to}(으)로 바꿀 수 없습니다.`);
}

/**
 * 작업 상태가 바뀔 때 주문 상태 (01 §3.1). 도착은 주문 "작업중"(도착·작업 시작)이고, 작업 시작은 주문 상태를 더 바꾸지 않는다.
 * null = 주문 상태 변경 없음.
 */
export function orderStatusForWork(to: WorkStatus): OrderStatus | null {
  switch (to) {
    case 'ON_THE_WAY':
      return 'ON_THE_WAY';
    case 'ARRIVED':
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'DONE':
      return 'WORK_DONE';
    case 'PENDING':
      return 'PENDING';
    default:
      return null;
  }
}
