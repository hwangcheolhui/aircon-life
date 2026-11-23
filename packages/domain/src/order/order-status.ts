/**
 * 주문 상태 전이 (01 §3.1 `service_order.status`). 주문 상태 변경은 반드시 이 전이표를 거치고
 * order_status_history 에 1행 INSERT 한다(CLAUDE.md §5, ERD §0.3-9).
 */

export const ORDER_STATUSES = [
  'QUOTED',
  'RECEIVED',
  'ASSIGN_WAIT',
  'ASSIGNED',
  'ON_THE_WAY',
  'IN_PROGRESS',
  'PENDING',
  'WORK_DONE',
  'COMPLETED',
  'CANCELED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** 01 §3.1 "다음 가능 상태" 열 그대로 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  QUOTED: ['RECEIVED', 'CANCELED'],
  RECEIVED: ['ASSIGN_WAIT', 'ASSIGNED', 'CANCELED'],
  ASSIGN_WAIT: ['ASSIGNED', 'CANCELED'],
  ASSIGNED: ['ON_THE_WAY', 'PENDING', 'CANCELED', 'ASSIGN_WAIT'],
  ON_THE_WAY: ['IN_PROGRESS', 'PENDING'],
  IN_PROGRESS: ['WORK_DONE', 'PENDING'],
  PENDING: ['ASSIGNED', 'CANCELED'],
  WORK_DONE: ['COMPLETED'],
  COMPLETED: [],
  CANCELED: [],
};

/** 주문 생성 시 첫 상태 (앱 예약·관리자 등록 = RECEIVED, 미지정 접수 = ASSIGN_WAIT, 견적 보관 = QUOTED) */
export const ORDER_INITIAL_STATUSES: readonly OrderStatus[] = ['QUOTED', 'RECEIVED', 'ASSIGN_WAIT'];

/** 종료되지 않은(진행 중) 주문 상태: 이중예약 확인(BR-020)·탈퇴 가능 여부(F-CUS-AUTH-05)에 쓴다 */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter(
  (s) => ORDER_TRANSITIONS[s].length > 0,
);

export function canTransitionOrder(from: string | null, to: OrderStatus): boolean {
  if (from === null) return ORDER_INITIAL_STATUSES.includes(to);
  return (ORDER_TRANSITIONS[from as OrderStatus] ?? []).includes(to);
}

export function assertOrderTransition(from: string | null, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) throw new Error(`주문 상태를 ${from ?? '(신규)'}에서 ${to}(으)로 바꿀 수 없습니다.`);
}

/** BR-030 고객 앱 취소·일정변경은 접수·배정완료에서만 */
export const CUSTOMER_CANCELABLE_STATUSES: readonly OrderStatus[] = ['RECEIVED', 'ASSIGNED'];
export function canCustomerCancel(status: string): boolean {
  return CUSTOMER_CANCELABLE_STATUSES.includes(status as OrderStatus);
}

export type ActorType = 'CUSTOMER' | 'TECHNICIAN' | 'ADMIN' | 'SYSTEM';

/** order_status_history 1행 (전이 검사 포함) */
export function orderStatusHistoryRow(input: {
  orderId: number;
  from: string | null;
  to: OrderStatus;
  actorType: ActorType;
  actorId: number | null;
  reasonCode?: string | null;
  memo?: string | null;
}) {
  assertOrderTransition(input.from, input.to);
  return {
    orderId: input.orderId,
    fromStatus: input.from,
    toStatus: input.to,
    reasonCode: input.reasonCode ?? null,
    memo: input.memo ?? null,
    actorType: input.actorType,
    actorId: input.actorId,
  };
}

/* ---------- 고객 일정변경·취소 요청 (01 §2.5.4 order_change_request.status) ---------- */

export const CHANGE_REQUEST_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};
export function assertChangeRequestTransition(from: string, to: 'APPROVED' | 'REJECTED'): void {
  if (!(CHANGE_REQUEST_TRANSITIONS[from] ?? []).includes(to)) throw new Error('이미 처리된 요청입니다.');
}
