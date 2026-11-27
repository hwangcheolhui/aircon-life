import { describe, expect, it } from 'vitest';
import { adminMemoSource, canEditMemo, checkMemoInput, memoDatesInRange, memoOccursOn, sortTodayMemos } from './memo-rules';

const m = (startDate: string, endDate: string, repeatType = 'NONE') => ({ startDate, endDate, repeatType });

describe('메모 기간·반복 (F-TEC-MEMO-01 · F-TEC-CAL-02)', () => {
  it('반복 없음은 시작~종료의 모든 날에 보인다', () => {
    expect(memoDatesInRange(m('2026-11-27', '2026-11-29'), '2026-11-01', '2026-11-30')).toEqual(['2026-11-27', '2026-11-28', '2026-11-29']);
    expect(memoOccursOn(m('2026-11-27', '2026-11-29'), '2026-11-30')).toBe(false);
  });
  it('매주 반복은 시작일과 같은 요일, 반복 종료일까지만', () => {
    expect(memoDatesInRange(m('2026-11-02', '2026-11-20', 'WEEKLY'), '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
  });
  it('매월 반복은 같은 날, 그 달에 없는 날이면 말일', () => {
    const memo = m('2026-01-31', '2026-05-31', 'MONTHLY');
    expect(memoOccursOn(memo, '2026-02-28')).toBe(true);
    expect(memoOccursOn(memo, '2026-04-30')).toBe(true);
    expect(memoOccursOn(memo, '2026-04-29')).toBe(false);
  });
  it('매년 반복은 같은 월·일, 2/29 는 평년에 2/28', () => {
    const memo = m('2024-02-29', '2027-12-31', 'YEARLY');
    expect(memoOccursOn(memo, '2026-02-28')).toBe(true);
    expect(memoOccursOn(memo, '2026-03-01')).toBe(false);
  });
  it('매일 반복은 기간 안 모든 날', () => {
    expect(memoDatesInRange(m('2026-11-28', '2026-12-31', 'DAILY'), '2026-11-27', '2026-11-30')).toEqual(['2026-11-28', '2026-11-29', '2026-11-30']);
  });
});

describe('메모 입력 검증', () => {
  const base = { content: '자재 챙기기', startDate: '2026-11-27', endDate: '2026-11-27', repeatType: 'NONE', today: '2026-11-27' };
  it('정상 입력은 통과', () => expect(checkMemoInput(base)).toBeNull());
  it('내용이 비면 필수 문구', () => expect(checkMemoInput({ ...base, content: '  ' })?.content).toBe('내용은 필수 입력값입니다.'));
  it('종료일이 시작일보다 앞서면 막는다', () => expect(checkMemoInput({ ...base, endDate: '2026-11-26' })?.endDate).toBeDefined());
  it('반복 없이 31일을 넘으면 반복을 쓰라고 안내', () => expect(checkMemoInput({ ...base, endDate: '2026-12-31' })?.endDate).toContain('반복'));
  it('반복이면 긴 반복 종료일도 허용', () => expect(checkMemoInput({ ...base, endDate: '2027-11-27', repeatType: 'WEEKLY' })).toBeNull());
  it('모르는 반복 값은 막는다', () => expect(checkMemoInput({ ...base, repeatType: 'HOURLY' })?.repeatType).toBeDefined());
});

describe('오늘의 메모 우선순위 (F-TEC-HOM-02)', () => {
  it('거점장 > 관리자 > 본인, 같은 순위는 미완료 먼저', () => {
    const rows = [
      { id: 1, prioritySource: 'SELF', isDone: false },
      { id: 2, prioritySource: 'ADMIN', isDone: true },
      { id: 3, prioritySource: 'BRANCH_MANAGER', isDone: false },
      { id: 4, prioritySource: 'ADMIN', isDone: false },
      { id: 5, prioritySource: null, isDone: true },
    ];
    expect(sortTodayMemos(rows).map((r) => r.id)).toEqual([3, 4, 2, 1, 5]);
  });
  it('거점장 역할이 보낸 지정 메모는 BRANCH_MANAGER, 그 밖 관리자는 ADMIN', () => {
    expect(adminMemoSource('ADM_BRANCH')).toBe('BRANCH_MANAGER');
    expect(adminMemoSource('ADM_OPS')).toBe('ADMIN');
  });
  it('기사는 본인이 쓴 메모만 고친다', () => {
    expect(canEditMemo({ ownerType: 'TECHNICIAN', ownerId: 7 }, 7)).toBe(true);
    expect(canEditMemo({ ownerType: 'ADMIN', ownerId: 7 }, 7)).toBe(false);
    expect(canEditMemo({ ownerType: 'TECHNICIAN', ownerId: 8 }, 7)).toBe(false);
  });
});
