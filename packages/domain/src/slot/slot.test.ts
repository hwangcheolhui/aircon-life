import { describe, expect, it } from 'vitest';
import {
  availableStartHours,
  buildSlotPlan,
  hoursOf,
  slotDates,
  slotHoursFor,
  slotsNeeded,
} from './slot';

const defaults = { defaultStart: '09:00', defaultEnd: '18:00', jobsPerTechHour: 1 };

describe('F-SYS-01 슬롯 자동 생성 (근무 기사 수 × 시간대)', () => {
  it('근무(WORK) 기사 수만큼 시간대별 수용 건수를 만든다', () => {
    const plan = buildSlotPlan({
      branchId: 1,
      dates: ['2027-03-10'],
      schedules: [
        { technicianId: 1, workDate: '2027-03-10', scheduleType: 'WORK', startTime: '09:00', endTime: '12:00' },
        { technicianId: 2, workDate: '2027-03-10', scheduleType: 'WORK', startTime: '10:00', endTime: '12:00' },
      ],
      ...defaults,
    });
    expect(plan.map((p) => [p.slotHour, p.capacity])).toEqual([
      [9, 1],
      [10, 2],
      [11, 2],
    ]);
    expect(plan.every((p) => p.slotKind === 'NORMAL' && p.branchId === 1)).toBe(true);
  });
  it('시간을 비워 둔 근무는 기본 근무시간, 시간당 처리량 설정값을 곱한다', () => {
    const plan = buildSlotPlan({
      branchId: 1,
      dates: ['2027-03-10'],
      schedules: [{ technicianId: 1, workDate: '2027-03-10', scheduleType: 'WORK', startTime: null, endTime: null }],
      ...defaults,
      jobsPerTechHour: 2,
    });
    expect(plan.map((p) => p.slotHour)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(plan[0]!.capacity).toBe(2);
  });
  it('예외: 휴무·연차·교육은 슬롯을 만들지 않고, 당직은 당직(ON_CALL) 슬롯이 된다', () => {
    const plan = buildSlotPlan({
      branchId: 1,
      dates: ['2027-03-13'],
      schedules: [
        { technicianId: 1, workDate: '2027-03-13', scheduleType: 'OFF', startTime: null, endTime: null },
        { technicianId: 2, workDate: '2027-03-13', scheduleType: 'ANNUAL', startTime: null, endTime: null },
        { technicianId: 3, workDate: '2027-03-13', scheduleType: 'TRAINING', startTime: null, endTime: null },
        { technicianId: 4, workDate: '2027-03-13', scheduleType: 'ON_CALL', startTime: '10:00', endTime: '11:00' },
      ],
      ...defaults,
    });
    expect(plan).toEqual([{ branchId: 1, slotDate: '2027-03-13', slotHour: 10, slotKind: 'ON_CALL', capacity: 1 }]);
  });
  it('오전 반차는 오후만, 오후 반차는 오전만 (시간을 비우면 기본 근무시간을 반으로 나눔)', () => {
    expect(hoursOf({ technicianId: 1, workDate: 'd', scheduleType: 'HALF_AM', startTime: null, endTime: null }, defaults)).toEqual([13, 14, 15, 16, 17]);
    expect(hoursOf({ technicianId: 1, workDate: 'd', scheduleType: 'HALF_PM', startTime: null, endTime: null }, defaults)).toEqual([9, 10, 11, 12]);
  });
  it('생성 대상 날짜 = 내일부터 설정 일수 (한국 날짜)', () => {
    expect(slotDates('2027-02-27', 3)).toEqual(['2027-02-28', '2027-03-01', '2027-03-02']);
  });
});

describe('BR-021 슬롯 잔여 수량·연속 슬롯', () => {
  const slots = [
    { slotHour: 9, capacity: 2, bookedCount: 2, isClosed: false },
    { slotHour: 10, capacity: 2, bookedCount: 1, isClosed: false },
    { slotHour: 11, capacity: 2, bookedCount: 0, isClosed: false },
    { slotHour: 12, capacity: 2, bookedCount: 0, isClosed: true },
    { slotHour: 13, capacity: 1, bookedCount: 0, isClosed: false },
  ];
  it('BR-021 잔여가 있는 시간만 고를 수 있다 (마감·만석 제외)', () => {
    expect(availableStartHours(slots, 1)).toEqual([10, 11, 13]);
  });
  it('BR-021 소요시간 2시간 이상이면 연속 슬롯이 모두 비어 있어야 한다', () => {
    expect(availableStartHours(slots, 2)).toEqual([10]);
    expect(availableStartHours(slots, 3)).toEqual([]);
  });
  it('BR-021 예외: 필요 인원이 잔여보다 많으면 고를 수 없다', () => {
    expect(availableStartHours(slots, 1, 2)).toEqual([11]);
  });
  it('필요 슬롯 수 = 2시간 미만은 1칸, 이상은 시간 올림', () => {
    expect(slotsNeeded(60)).toBe(1);
    expect(slotsNeeded(110)).toBe(1);
    expect(slotsNeeded(120)).toBe(2);
    expect(slotsNeeded(150)).toBe(3);
    expect(slotHoursFor(10, 150)).toEqual([10, 11, 12]);
  });
});
