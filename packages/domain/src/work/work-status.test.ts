import { describe, expect, it } from 'vitest';
import {
  ACTIVE_WORK_STATUSES,
  assertWorkTransition,
  canTransitionWork,
  orderStatusForWork,
} from './work-status';

describe('01 §3.2 작업 상태 전이 (work_order.status)', () => {
  it('정상 흐름 READY → ON_THE_WAY → ARRIVED → IN_PROGRESS → DONE', () => {
    expect(canTransitionWork(null, 'READY')).toBe(true);
    expect(canTransitionWork('READY', 'ON_THE_WAY')).toBe(true);
    expect(canTransitionWork('ON_THE_WAY', 'ARRIVED')).toBe(true);
    expect(canTransitionWork('ARRIVED', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionWork('IN_PROGRESS', 'DONE')).toBe(true);
  });

  it('예외: 단계를 건너뛰거나 되돌릴 수 없다', () => {
    expect(canTransitionWork('READY', 'ARRIVED')).toBe(false);
    expect(canTransitionWork('ON_THE_WAY', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionWork('ARRIVED', 'DONE')).toBe(false);
    expect(canTransitionWork('IN_PROGRESS', 'ON_THE_WAY')).toBe(false);
    expect(canTransitionWork('DONE', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionWork(null, 'ON_THE_WAY')).toBe(false);
    expect(() => assertWorkTransition('READY', 'DONE')).toThrow();
  });

  it('미처리(PENDING)는 완료 전 어느 단계에서든, 재약속하면 다시 READY', () => {
    for (const s of ['READY', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'] as const)
      expect(canTransitionWork(s, 'PENDING')).toBe(true);
    expect(canTransitionWork('DONE', 'PENDING')).toBe(false);
    expect(canTransitionWork('PENDING', 'READY')).toBe(true);
    expect(canTransitionWork('PENDING', 'CANCELED')).toBe(true);
  });

  it('진행 중 작업 = 이동중·도착·작업중 (기사 앱 고정 배너)', () => {
    expect([...ACTIVE_WORK_STATUSES]).toEqual(['ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS']);
  });
});

describe('작업 상태 → 주문 상태 동기화 (01 §3.1·3.2)', () => {
  it('출발 = 이동중, 도착 = 작업중(도착·작업 시작), 완료 = 작업완료', () => {
    expect(orderStatusForWork('ON_THE_WAY')).toBe('ON_THE_WAY');
    expect(orderStatusForWork('ARRIVED')).toBe('IN_PROGRESS');
    expect(orderStatusForWork('IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(orderStatusForWork('DONE')).toBe('WORK_DONE');
    expect(orderStatusForWork('PENDING')).toBe('PENDING');
  });

  it('READY 는 주문 상태를 바꾸지 않는다', () => {
    expect(orderStatusForWork('READY')).toBeNull();
  });
});
