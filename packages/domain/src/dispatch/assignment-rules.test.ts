import { describe, expect, it } from 'vitest';
import {
  type AssignTech,
  type AssignOrder,
  checkAssignmentPlan,
  checkTechForRole,
  needsAccompany,
  isUnassignedUrgent,
  blocking,
} from './assignment-rules';

const at = (hhmm: string, date = '2027-03-02') => new Date(`${date}T${hhmm}:00+09:00`);

const tech = (over: Partial<AssignTech> = {}): AssignTech => ({
  id: 1,
  name: '김기사',
  status: 'ACTIVE',
  grade: 'REGULAR',
  accompanyRequiredCount: 3,
  accompanyDoneCount: 3,
  skills: [
    { deviceType: 'WALL', skillLevel: 'CAN_SOLO' },
    { deviceType: 'STAND', skillLevel: 'CAN_SOLO' },
  ],
  areaCodes: ['4113511000'],
  ...over,
});

const order = (over: Partial<AssignOrder> = {}): AssignOrder => ({
  deviceTypes: ['WALL'],
  legalDongCode: '4113511000',
  start: at('10:00'),
  end: at('12:00'),
  requiredTechCount: 1,
  ...over,
});

const work = { scheduleType: 'WORK', startTime: '09:00', endTime: '18:00' };
const defaults = { defaultStart: '09:00', defaultEnd: '18:00' };
const base = { order: order(), schedule: work, busy: [], bufferMin: 30, defaults };
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('배정 검증 — 정상', () => {
  it('근무 중·숙련·관할 안·겹침 없음이면 경고가 없다', () => {
    expect(checkTechForRole({ ...base, tech: tech(), role: 'MAIN' })).toEqual([]);
  });
});

describe('BR-070 기사 상태', () => {
  it('BR-070 활동(ACTIVE) 기사는 주기사로 단독 배정할 수 있다', () => {
    expect(blocking(checkTechForRole({ ...base, tech: tech(), role: 'MAIN' }))).toEqual([]);
  });
  it('BR-070 교육중(TRAINING) 기사는 주기사·지원기사로 배정할 수 없다', () => {
    expect(codes(blocking(checkTechForRole({ ...base, tech: tech({ status: 'TRAINING' }), role: 'MAIN' })))).toContain('TRAINING_ACCOMPANY_ONLY');
    expect(codes(blocking(checkTechForRole({ ...base, tech: tech({ status: 'TRAINING' }), role: 'SUPPORT' })))).toContain('TRAINING_ACCOMPANY_ONLY');
  });
  it('BR-070 교육중(TRAINING) 기사는 교육 동행(ACCOMPANY)으로는 배정할 수 있다', () => {
    expect(blocking(checkTechForRole({ ...base, tech: tech({ status: 'TRAINING' }), role: 'ACCOMPANY' }))).toEqual([]);
  });
  it('BR-070 휴직·이탈·지원 상태 기사는 어떤 역할로도 배정할 수 없다', () => {
    for (const status of ['PAUSED', 'LEFT', 'APPLICANT']) {
      expect(codes(blocking(checkTechForRole({ ...base, tech: tech({ status }), role: 'ACCOMPANY' })))).toContain('NOT_ASSIGNABLE');
    }
  });
});

describe('BR-071 신규(견습) 기사 초기 동행', () => {
  const trainee = (done: number) => tech({ id: 9, grade: 'TRAINEE', accompanyDoneCount: done, accompanyRequiredCount: 3 });
  it('BR-071 견습 기사가 동행 3건을 마치기 전이면 동행 대상이다', () => {
    expect(needsAccompany(trainee(2))).toBe(true);
    expect(needsAccompany(trainee(3))).toBe(false);
    expect(needsAccompany(tech({ grade: 'REGULAR', accompanyDoneCount: 0 }))).toBe(false);
  });
  it('BR-071 동행을 마치기 전 견습 기사는 주기사로 단독 배정할 수 없다', () => {
    expect(codes(blocking(checkTechForRole({ ...base, tech: trainee(1), role: 'MAIN' })))).toContain('ACCOMPANY_REQUIRED');
  });
  it('BR-071 동행을 마친 견습 기사는 단독 배정할 수 있다', () => {
    expect(blocking(checkTechForRole({ ...base, tech: trainee(3), role: 'MAIN' }))).toEqual([]);
  });
  it('BR-071 교육 동행의 주기사는 팀장(LEADER)이어야 한다', () => {
    const plan = checkAssignmentPlan({ order: order(), main: tech({ grade: 'REGULAR' }), support: null, accompany: trainee(0) });
    expect(codes(blocking(plan))).toContain('ACCOMPANY_NEEDS_LEADER');
    const ok = checkAssignmentPlan({ order: order(), main: tech({ grade: 'LEADER' }), support: null, accompany: trainee(0) });
    expect(blocking(ok)).toEqual([]);
  });
});

describe('BR-072 숙련', () => {
  it('BR-072 숙련에 없는 기기 유형이면 경고(확정은 가능)', () => {
    const issues = checkTechForRole({ ...base, order: order({ deviceTypes: ['CEILING_4WAY'] }), tech: tech(), role: 'MAIN' });
    expect(codes(issues)).toContain('NO_SKILL');
    expect(blocking(issues)).toEqual([]);
  });
  it('BR-072 CAN_ASSIST만 있으면 주기사로 배정할 수 없다', () => {
    const t = tech({ skills: [{ deviceType: 'WALL', skillLevel: 'CAN_ASSIST' }] });
    expect(codes(blocking(checkTechForRole({ ...base, tech: t, role: 'MAIN' })))).toContain('ASSIST_ONLY');
  });
  it('BR-072 CAN_ASSIST만 있어도 지원기사로는 배정할 수 있다', () => {
    const t = tech({ skills: [{ deviceType: 'WALL', skillLevel: 'CAN_ASSIST' }] });
    expect(blocking(checkTechForRole({ ...base, tech: t, role: 'SUPPORT' }))).toEqual([]);
  });
});

describe('F-ADM-DSP-01 근무·시간 겹침·활동지역 경고', () => {
  it('근무 일정이 없거나 휴무면 경고', () => {
    expect(codes(checkTechForRole({ ...base, schedule: null, tech: tech(), role: 'MAIN' }))).toContain('NO_SCHEDULE');
    expect(codes(checkTechForRole({ ...base, schedule: { scheduleType: 'OFF', startTime: null, endTime: null }, tech: tech(), role: 'MAIN' }))).toContain('OFF_DAY');
  });
  it('근무 시간 밖 약속이면 경고 (오후 반차 기사에게 오후 약속)', () => {
    const half = { scheduleType: 'HALF_PM', startTime: null, endTime: null };
    expect(codes(checkTechForRole({ ...base, schedule: half, order: order({ start: at('14:00'), end: at('16:00') }), tech: tech(), role: 'MAIN' }))).toContain('OUT_OF_HOURS');
    expect(codes(checkTechForRole({ ...base, schedule: half, tech: tech(), role: 'MAIN' }))).not.toContain('OUT_OF_HOURS');
  });
  it('이동 버퍼(30분)를 포함해 다른 약속과 겹치면 경고', () => {
    const busy = [{ orderNo: 'A1', start: at('12:10'), end: at('13:00') }];
    expect(codes(checkTechForRole({ ...base, busy, tech: tech(), role: 'MAIN' }))).toContain('OVERLAP');
    const far = [{ orderNo: 'A2', start: at('12:30'), end: at('13:00') }];
    expect(codes(checkTechForRole({ ...base, busy: far, tech: tech(), role: 'MAIN' }))).not.toContain('OVERLAP');
  });
  it('활동지역 밖 주소면 경고, 활동지역 미지정 기사도 경고', () => {
    expect(codes(checkTechForRole({ ...base, order: order({ legalDongCode: '1111010100' }), tech: tech(), role: 'MAIN' }))).toContain('OUT_OF_AREA');
    expect(codes(checkTechForRole({ ...base, tech: tech({ areaCodes: [] }), role: 'MAIN' }))).toContain('NO_AREA');
  });
});

describe('F-ADM-DSP-03 2인·동행 배정', () => {
  it('2인 작업은 지원기사 없이 확정할 수 없다', () => {
    const r = checkAssignmentPlan({ order: order({ requiredTechCount: 2 }), main: tech(), support: null, accompany: null });
    expect(codes(blocking(r))).toContain('SUPPORT_REQUIRED');
  });
  it('2인 작업에 지원기사를 넣으면 확정할 수 있다', () => {
    const r = checkAssignmentPlan({ order: order({ requiredTechCount: 2 }), main: tech(), support: tech({ id: 2, name: '이기사' }), accompany: null });
    expect(blocking(r)).toEqual([]);
  });
  it('같은 기사를 두 역할에 넣을 수 없다', () => {
    const r = checkAssignmentPlan({ order: order({ requiredTechCount: 2 }), main: tech(), support: tech(), accompany: null });
    expect(codes(blocking(r))).toContain('DUPLICATE_TECH');
  });
});

describe('F-SYS-09 BR-024 미지정 건 경고', () => {
  const now = at('09:00');
  it('미지정(ASSIGN_WAIT) 건의 약속이 4시간 이내면 경고 대상', () => {
    expect(isUnassignedUrgent({ status: 'ASSIGN_WAIT', promisedAt: at('12:59') }, now, 4)).toBe(true);
    expect(isUnassignedUrgent({ status: 'ASSIGN_WAIT', promisedAt: at('08:30') }, now, 4)).toBe(true);
  });
  it('4시간보다 멀었거나 이미 배정된 건은 경고하지 않는다', () => {
    expect(isUnassignedUrgent({ status: 'ASSIGN_WAIT', promisedAt: at('13:01') }, now, 4)).toBe(false);
    expect(isUnassignedUrgent({ status: 'ASSIGNED', promisedAt: at('10:00') }, now, 4)).toBe(false);
    expect(isUnassignedUrgent({ status: 'ASSIGN_WAIT', promisedAt: null }, now, 4)).toBe(false);
  });
});
