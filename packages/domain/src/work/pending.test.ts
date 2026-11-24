import { describe, expect, it } from 'vitest';
import { absentStreak, checkPendingInput, isLongPending, needsOperatorConfirm, pendingSince } from './pending';

describe('F-TEC-WRK-08 미처리 저장', () => {
  it('BR-031 미처리 사유는 필수, 기타는 메모 필수', () => {
    expect(checkPendingInput({ pendingCode: 'CUSTOMER_ABSENT', memo: '', revisitDate: null, today: '2026-12-01' })).toEqual({});
    expect(checkPendingInput({ pendingCode: '', memo: '', revisitDate: null, today: '2026-12-01' }).pendingCode).toBe('미처리 사유는 필수 입력값입니다.');
    expect(checkPendingInput({ pendingCode: 'ETC', memo: ' ', revisitDate: null, today: '2026-12-01' }).memo).toBeTruthy();
  });

  it('예외: 재약속 희망일은 오늘 이후여야 한다', () => {
    expect(checkPendingInput({ pendingCode: 'POSTPONED_CUSTOMER', memo: '', revisitDate: '2026-11-30', today: '2026-12-01' }).revisitDate).toBeTruthy();
    expect(checkPendingInput({ pendingCode: 'POSTPONED_CUSTOMER', memo: '', revisitDate: '2026-12-01', today: '2026-12-01' })).toEqual({});
  });
});

describe('BR-031 고객부재 2회 연속', () => {
  const h = (toStatus: string, reasonCode: string | null = null) => ({ toStatus, reasonCode });

  it('직전까지 이어진 고객부재 미처리 횟수를 센다', () => {
    expect(absentStreak([h('ASSIGNED'), h('PENDING', 'CUSTOMER_ABSENT'), h('ASSIGNED'), h('PENDING', 'CUSTOMER_ABSENT')])).toBe(2);
    expect(absentStreak([h('PENDING', 'CUSTOMER_ABSENT'), h('ASSIGNED'), h('PENDING', 'POSTPONED_CUSTOMER')])).toBe(0);
    expect(absentStreak([h('PENDING', 'POSTPONED_CUSTOMER'), h('ASSIGNED'), h('PENDING', 'CUSTOMER_ABSENT')])).toBe(1);
  });

  it('2회 연속이면 운영자 확인 후에만 재약속', () => {
    expect(needsOperatorConfirm(1)).toBe(false);
    expect(needsOperatorConfirm(2)).toBe(true);
    expect(needsOperatorConfirm(3)).toBe(true);
  });
});

describe('BR-032 장기 미처리', () => {
  const now = new Date('2026-12-03T00:00:00Z');

  it('PENDING 이 된 시각부터 기준 시간이 지나면 장기 미처리', () => {
    expect(isLongPending('PENDING', new Date('2026-12-01T00:00:00Z'), now, 48)).toBe(true);
    expect(isLongPending('PENDING', new Date('2026-12-01T00:00:01Z'), now, 48)).toBe(false);
  });

  it('예외: 미처리가 아니면 장기 미처리가 아니다', () => {
    expect(isLongPending('ASSIGNED', new Date('2026-11-01T00:00:00Z'), now, 48)).toBe(false);
    expect(isLongPending('PENDING', null, now, 48)).toBe(false);
  });

  it('가장 최근 PENDING 진입 시각', () => {
    const t1 = new Date('2026-11-01T00:00:00Z');
    const t2 = new Date('2026-11-05T00:00:00Z');
    expect(pendingSince([{ toStatus: 'PENDING', createdAt: t1 }, { toStatus: 'ASSIGNED', createdAt: t1 }, { toStatus: 'PENDING', createdAt: t2 }])).toEqual(t2);
    expect(pendingSince([{ toStatus: 'ASSIGNED', createdAt: t1 }])).toBeNull();
  });
});
