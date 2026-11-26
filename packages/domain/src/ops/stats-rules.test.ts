import { describe, expect, it } from 'vitest';
import {
  avgWorkMinutesByType,
  distribution,
  isDormantNoticeDue,
  isDormantTarget,
  lastActivityDate,
  newVsRepeat,
  opsRates,
  pctOf,
  techPerformance,
} from './stats-rules';

describe('운영 통계 (F-ADM-STA-02)', () => {
  it('완료율·취소율·미처리율(취소 제외)·슬롯 가동률', () => {
    expect(opsRates({ orders: 20, completed: 15, canceled: 4, pendingEver: 2, slotCapacity: 40, slotBooked: 30 })).toEqual({
      completedRate: 75,
      cancelRate: 20,
      pendingRate: 12.5,
      slotUtilization: 75,
    });
    expect(opsRates({ orders: 0, completed: 0, canceled: 0, pendingEver: 0, slotCapacity: 0, slotBooked: 0 }).cancelRate).toBeNull();
  });
  it('기기 유형별 평균 작업시간(작업시간 없는 건 제외)', () => {
    expect(
      avgWorkMinutesByType([
        { deviceTypes: ['WALL'], workMinutes: 60 },
        { deviceTypes: ['WALL', 'STAND'], workMinutes: 120 },
        { deviceTypes: ['STAND'], workMinutes: null },
      ]),
    ).toEqual([
      { deviceType: 'STAND', jobs: 1, avgMinutes: 120 },
      { deviceType: 'WALL', jobs: 2, avgMinutes: 90 },
    ]);
  });
});

describe('기사 성과 (F-ADM-STA-03, BR-051)', () => {
  it('BR-051 귀책 AS 건수로 AS율, 평점 평균, 건수 많은 순', () => {
    const r = techPerformance([
      { techId: 1, name: 'A', jobs: 10, sales: 1_000_000, ratings: [5, 4], vocComplaints: 1, asCount: 1, workMinutes: [60, 90] },
      { techId: 2, name: 'B', jobs: 20, sales: 1_500_000, ratings: [], vocComplaints: 0, asCount: 0, workMinutes: [] },
    ]);
    expect(r.map((x) => x.techId)).toEqual([2, 1]);
    expect(r[1]).toMatchObject({ ratingAvg: 4.5, asRate: 10, avgWorkMinutes: 75, reviewCount: 2 });
    expect(r[0]).toMatchObject({ ratingAvg: null, asRate: 0, avgWorkMinutes: null });
  });
});

describe('고객·CRM 통계 (F-ADM-STA-04)', () => {
  it('기간 안 완료 고객을 신규·재방문으로 나누고 재방문율', () => {
    expect(newVsRepeat([{ firstCompletedDate: '2026-11-03' }, { firstCompletedDate: '2025-07-01' }, { firstCompletedDate: '2026-02-01' }], '2026-11-01')).toEqual({
      total: 3,
      fresh: 1,
      repeat: 2,
      repeatRate: 66.7,
    });
  });
  it('분포는 건수 많은 순, 값이 없으면 UNKNOWN', () => {
    expect(distribution(['APT', 'APT', null, 'VILLA'])).toEqual([
      { key: 'APT', count: 2, rate: 50 },
      { key: 'UNKNOWN', count: 1, rate: 25 },
      { key: 'VILLA', count: 1, rate: 25 },
    ]);
    expect(pctOf(1, 3)).toBe(33.3);
  });
});

describe('휴면 전환 (F-SYS-13)', () => {
  it('마지막 이용일은 날짜들 중 가장 늦은 날', () => {
    expect(lastActivityDate(['2025-01-01', null, '2025-06-01'])).toBe('2025-06-01');
    expect(lastActivityDate([null])).toBeNull();
  });
  it('마지막 이용 후 N개월이 지난 활동 고객만, 진행 중 주문이 있으면 제외', () => {
    const base = { status: 'ACTIVE', lastActivity: '2025-11-26', hasActiveOrder: false, today: '2026-11-26', months: 12 };
    expect(isDormantTarget(base)).toBe(true);
    expect(isDormantTarget({ ...base, lastActivity: '2025-11-27' })).toBe(false);
    expect(isDormantTarget({ ...base, hasActiveOrder: true })).toBe(false);
    expect(isDormantTarget({ ...base, status: 'WITHDRAWN' })).toBe(false);
  });
  it('전환 30일 전부터 1회 사전 안내', () => {
    const base = { status: 'ACTIVE', lastActivity: '2025-12-20', hasActiveOrder: false, today: '2026-11-26', months: 12, noticeDays: 30, lastNoticedAt: null };
    expect(isDormantNoticeDue(base)).toBe(true);
    expect(isDormantNoticeDue({ ...base, lastActivity: '2026-01-10' })).toBe(false); // 45일 남음
    expect(isDormantNoticeDue({ ...base, lastNoticedAt: '2026-11-20' })).toBe(false);
    expect(isDormantNoticeDue({ ...base, lastNoticedAt: '2025-01-01' })).toBe(true); // 이전 주기 안내
  });
});
