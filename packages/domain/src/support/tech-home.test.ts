import { describe, expect, it } from 'vitest';
import { monthlyIncome, moveQuickMenu, normalizeQuickMenu, recentMonths, toggleQuickMenu, weeklyTodo } from './tech-home';

describe('퀵메뉴 (F-TEC-HOM-04)', () => {
  it('★ 토글: 없으면 맨 뒤에 추가, 있으면 뺀다', () => {
    expect(toggleQuickMenu(['T-CAL-010'], 'T-MAT-020')).toEqual(['T-CAL-010', 'T-MAT-020']);
    expect(toggleQuickMenu(['T-CAL-010', 'T-MAT-020'], 'T-CAL-010')).toEqual(['T-MAT-020']);
  });
  it('모르는 화면·중복은 저장하지 않는다(개수 제한은 없음)', () => {
    expect(normalizeQuickMenu(['T-CAL-010', 'A-ORD-010', 'T-CAL-010', 'T-EDU-010'])).toEqual(['T-CAL-010', 'T-EDU-010']);
    expect(toggleQuickMenu([], 'X-1')).toEqual([]);
  });
  it('순서 변경(드래그·위아래 공용), 범위를 벗어나면 그대로', () => {
    expect(moveQuickMenu(['T-CAL-010', 'T-MAT-020', 'T-EDU-010'], 2, 0)).toEqual(['T-EDU-010', 'T-CAL-010', 'T-MAT-020']);
    expect(moveQuickMenu(['T-CAL-010', 'T-MAT-020'], 1, 5)).toEqual(['T-CAL-010', 'T-MAT-020']);
  });
});

describe('주간 할일 D-day~D+2 (F-TEC-HOM-03)', () => {
  it('날짜별 메모·자재·약속 건수(취소 제외)', () => {
    const r = weeklyTodo({
      today: '2026-11-27',
      memos: [
        { startDate: '2026-11-27', endDate: '2026-11-28', repeatType: 'NONE' },
        { startDate: '2026-11-01', endDate: '2026-12-31', repeatType: 'WEEKLY' }, // 일요일(11-29) 반복
      ],
      materials: [
        { status: 'SHIPPED', neededDate: '2026-11-28' },
        { status: 'REQUESTED', neededDate: '2026-11-29' },
      ],
      jobs: [
        { date: '2026-11-27', status: 'ASSIGNED' },
        { date: '2026-11-27', status: 'CANCELED' },
        { date: '2026-11-28', status: 'ASSIGNED' },
      ],
    });
    expect(r).toEqual([
      { date: '2026-11-27', label: 'D-day', memo: 1, material: 1, job: 1 },
      { date: '2026-11-28', label: 'D+1', memo: 1, material: 0, job: 1 },
      { date: '2026-11-29', label: 'D+2', memo: 1, material: 1, job: 0 },
    ]);
  });
});

describe('월 수입 요약 (F-TEC-STL-03)', () => {
  it('최근 6개월(오래된 달 먼저), 연도를 넘긴다', () => expect(recentMonths('2026-02-10', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']));
  it('회차 종료일 달로 실지급을 더한다(음수 회차 포함)', () => {
    const r = monthlyIncome(
      [
        { periodEnd: '2026-10-25', netPay: 300000 },
        { periodEnd: '2026-11-01', netPay: 200000 },
        { periodEnd: '2026-11-08', netPay: -10000 },
      ],
      ['2026-10', '2026-11', '2026-12'],
    );
    expect(r).toEqual([
      { month: '2026-10', amount: 300000, count: 1 },
      { month: '2026-11', amount: 190000, count: 2 },
      { month: '2026-12', amount: 0, count: 0 },
    ]);
  });
});
