import { describe, expect, it } from 'vitest';
import {
  ACTIVE_ORDER_STATUSES,
  ORDER_TRANSITIONS,
  assertOrderTransition,
  canCustomerCancel,
  canTransitionOrder,
  orderStatusHistoryRow,
} from './order-status';

describe('01 §3.1 주문 상태 전이', () => {
  it('접수(RECEIVED)는 배정대기·배정완료·취소로만 갈 수 있다', () => {
    expect(ORDER_TRANSITIONS.RECEIVED).toEqual(['ASSIGN_WAIT', 'ASSIGNED', 'CANCELED']);
    expect(canTransitionOrder('RECEIVED', 'CANCELED')).toBe(true);
    expect(canTransitionOrder('RECEIVED', 'COMPLETED')).toBe(false);
  });
  it('완료·취소는 종료 상태라 더 이상 바뀌지 않는다', () => {
    expect(canTransitionOrder('COMPLETED', 'CANCELED')).toBe(false);
    expect(canTransitionOrder('CANCELED', 'RECEIVED')).toBe(false);
  });
  it('새 주문은 상태 없음(null)에서 접수·배정대기로만 만든다', () => {
    expect(canTransitionOrder(null, 'RECEIVED')).toBe(true);
    expect(canTransitionOrder(null, 'ASSIGN_WAIT')).toBe(true);
    expect(canTransitionOrder(null, 'ASSIGNED')).toBe(false);
  });
  it('ERD에 없는 전이는 오류', () => {
    expect(() => assertOrderTransition('WORK_DONE', 'CANCELED')).toThrow();
    expect(() => assertOrderTransition('RECEIVED', 'CANCELED')).not.toThrow();
  });
  it('상태 이력 1행을 만든다 (INSERT ONLY order_status_history)', () => {
    expect(
      orderStatusHistoryRow({ orderId: 7, from: 'RECEIVED', to: 'CANCELED', actorType: 'CUSTOMER', actorId: 3, reasonCode: 'CUSTOMER_REQUEST' }),
    ).toEqual({ orderId: 7, fromStatus: 'RECEIVED', toStatus: 'CANCELED', reasonCode: 'CUSTOMER_REQUEST', memo: null, actorType: 'CUSTOMER', actorId: 3 });
    expect(() => orderStatusHistoryRow({ orderId: 7, from: 'COMPLETED', to: 'RECEIVED', actorType: 'ADMIN', actorId: 1 })).toThrow();
  });
  it('진행 중 주문 = 완료·취소가 아닌 주문', () => {
    expect(ACTIVE_ORDER_STATUSES).not.toContain('COMPLETED');
    expect(ACTIVE_ORDER_STATUSES).not.toContain('CANCELED');
    expect(ACTIVE_ORDER_STATUSES).toContain('RECEIVED');
  });
});

describe('BR-030 고객 취소 가능 상태', () => {
  it('BR-030 접수·배정완료에서만 고객이 취소할 수 있다', () => {
    expect(canCustomerCancel('RECEIVED')).toBe(true);
    expect(canCustomerCancel('ASSIGNED')).toBe(true);
  });
  it('BR-030 예외: 배정대기·이동중·작업중·완료는 고객이 취소할 수 없다', () => {
    for (const s of ['ASSIGN_WAIT', 'ON_THE_WAY', 'IN_PROGRESS', 'WORK_DONE', 'COMPLETED', 'CANCELED']) {
      expect(canCustomerCancel(s)).toBe(false);
    }
  });
});

describe('F-ADM-ORD-05 변경·취소 요청 처리', () => {
  it('요청(REQUESTED)만 승인·반려할 수 있다', async () => {
    const { assertChangeRequestTransition } = await import('./order-status');
    expect(() => assertChangeRequestTransition('REQUESTED', 'APPROVED')).not.toThrow();
    expect(() => assertChangeRequestTransition('APPROVED', 'REJECTED')).toThrow(/이미 처리/);
  });
});
