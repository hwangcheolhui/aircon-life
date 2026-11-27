import { describe, expect, it } from 'vitest';
import { isMonthStr, monthGrid, shiftMonth, weekGrid, weekStartOf, workDaySummary } from './tech-calendar';

describe('월 달력 (F-TEC-CAL-01)', () => {
  it('일요일 시작 7칸, 그 달이 아닌 칸은 비움', () => {
    const g = monthGrid('2026-11'); // 11/1 = 일요일
    expect(g[0]![0]).toBe('2026-11-01');
    expect(g.at(-1)!.filter(Boolean).at(-1)).toBe('2026-11-30');
    expect(g.every((w) => w.length === 7)).toBe(true);
    const feb = monthGrid('2026-02'); // 2/1 = 일요일, 28일
    expect(feb.length).toBe(4);
  });
  it('달 이동·형식 검사', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(isMonthStr('2026-13')).toBe(false);
    expect(isMonthStr('2026-11')).toBe(true);
  });
});

describe('근무 모드 날짜 요약 (F-TEC-CAL-01 · BR-032)', () => {
  const jobs = [
    { date: '2026-11-20', status: 'COMPLETED', longPending: false },
    { date: '2026-11-20', status: 'PENDING', longPending: true },
    { date: '2026-11-20', status: 'CANCELED', longPending: false },
    { date: '2026-11-27', status: 'ASSIGNED', longPending: false },
    { date: '2026-11-27', status: 'WORK_DONE', longPending: false },
  ];
  it('BR-032 지난 날: 접수 2(취소 제외)/미처리 1, 장기 미처리 강조', () =>
    expect(workDaySummary('2026-11-20', '2026-11-27', jobs)).toEqual({ total: 2, pending: 1, remaining: 0, longPending: true, mode: 'PAST' }));
  it('오늘: 남은 1(완료 제외)/미처리 0', () =>
    expect(workDaySummary('2026-11-27', '2026-11-27', jobs)).toEqual({ total: 2, pending: 0, remaining: 1, longPending: false, mode: 'UPCOMING' }));
});

describe('주간 일정 7일 × 시간 (F-TEC-RTE-05)', () => {
  const defaults = { defaultStart: '09:00', defaultEnd: '18:00' };
  it('작업·빈 시간·휴무·근무 시간 밖을 나눈다', () => {
    const days = weekGrid({
      startDate: '2026-11-23',
      fromHour: 8,
      toHour: 19,
      defaults,
      schedules: [
        { workDate: '2026-11-23', scheduleType: 'WORK', startTime: null, endTime: null },
        { workDate: '2026-11-24', scheduleType: 'OFF', startTime: null, endTime: null },
        { workDate: '2026-11-25', scheduleType: 'HALF_AM', startTime: null, endTime: null },
      ],
      jobs: [{ date: '2026-11-23', start: '10:30', end: '12:00', orderNo: 'A1', status: 'ASSIGNED' }],
    });
    const mon = days[0]!;
    expect(mon.cells.find((c) => c.hour === 8)!.state).toBe('OUT');
    expect(mon.cells.find((c) => c.hour === 9)!.state).toBe('FREE');
    expect(mon.cells.filter((c) => c.state === 'JOB').map((c) => c.hour)).toEqual([10, 11]);
    expect(mon.freeHours).toBe(7);
    expect(days[1]!.dayOff).toBe(true);
    expect(days[1]!.cells.every((c) => c.state === 'OFF')).toBe(true);
    // 오전 반차 → 오후(13시~)만 근무
    expect(days[2]!.cells.find((c) => c.hour === 10)!.state).toBe('OUT');
    expect(days[2]!.cells.find((c) => c.hour === 13)!.state).toBe('FREE');
    // 근무표 없는 날은 근무 시간 밖
    expect(days[3]!.cells.every((c) => c.state === 'OUT')).toBe(true);
  });
  it('휴무일에 작업이 있으면 그 칸은 작업으로 표시', () => {
    const [d] = weekGrid({
      startDate: '2026-11-24',
      fromHour: 9,
      toHour: 12,
      defaults,
      schedules: [{ workDate: '2026-11-24', scheduleType: 'OFF', startTime: null, endTime: null }],
      jobs: [{ date: '2026-11-24', start: '09:00', end: '10:00', orderNo: 'B1', status: 'ASSIGNED' }],
    });
    expect(d!.cells.map((c) => c.state)).toEqual(['JOB', 'OFF', 'OFF']);
  });
  it('주 첫날은 월요일', () => {
    expect(weekStartOf('2026-11-29')).toBe('2026-11-23'); // 일요일 → 그 주 월요일
    expect(weekStartOf('2026-11-23')).toBe('2026-11-23');
  });
});
