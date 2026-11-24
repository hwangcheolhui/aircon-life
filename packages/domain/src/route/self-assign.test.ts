import { describe, expect, it } from 'vitest';
import { canCollectLocation, checkSelfAssign, customerVisitTime, isUnassignedVisible } from './self-assign';

const today = '2026-12-01';
const order = {
  status: 'ASSIGN_WAIT',
  legalDongCode: 'D1',
  date: '2026-12-02',
  deviceTypes: ['WALL'],
  requiredTechCount: 1,
};
const tech = {
  status: 'ACTIVE',
  grade: 'REGULAR',
  accompanyDoneCount: 0,
  accompanyRequiredCount: 3,
  skills: [{ deviceType: 'WALL', skillLevel: 'CAN_SOLO' }],
};
const areas = [
  { code: 'D1', priority: 1 },
  { code: 'D2', priority: 2 },
];
const ok = {
  enabled: true,
  needsApprovalSetting: false,
  order,
  tech,
  areas,
  today,
  daysAhead: 7,
  working: true,
  insertionOk: true,
};

describe('BR-110 관할 밖 미배정 작업은 보이지 않는다', () => {
  it('내 관할 법정동 + 배정 전 + 오늘~7일 이내만 보인다', () => {
    expect(isUnassignedVisible(order, areas, today, 7)).toBe(true);
    expect(isUnassignedVisible({ ...order, status: 'RECEIVED' }, areas, today, 7)).toBe(true);
    expect(isUnassignedVisible({ ...order, legalDongCode: 'D9' }, areas, today, 7)).toBe(false);
    expect(isUnassignedVisible({ ...order, legalDongCode: null }, areas, today, 7)).toBe(false);
    expect(isUnassignedVisible({ ...order, status: 'ASSIGNED' }, areas, today, 7)).toBe(false);
    expect(isUnassignedVisible({ ...order, date: '2026-12-09' }, areas, today, 7)).toBe(false);
    expect(isUnassignedVisible({ ...order, date: '2026-11-30' }, areas, today, 7)).toBe(false);
  });
});

describe('BR-111 자가 배정은 주 관할만 바로, 보조 관할은 운영자 승인', () => {
  it('주 관할 + 승인 불필요 설정이면 즉시 확정', () => {
    expect(checkSelfAssign(ok)).toEqual({
      visible: true,
      canRequest: true,
      needsApproval: false,
      reasons: [],
    });
  });

  it('승인 필요 설정이면 주 관할도 승인 대기', () => {
    expect(checkSelfAssign({ ...ok, needsApprovalSetting: true }).needsApproval).toBe(true);
  });

  it('보조 관할은 설정과 관계없이 승인 필요', () => {
    const r = checkSelfAssign({ ...ok, order: { ...order, legalDongCode: 'D2' } });
    expect(r).toMatchObject({ canRequest: true, needsApproval: true });
  });

  it('2인 작업은 요청만 가능(승인 필요)', () => {
    expect(checkSelfAssign({ ...ok, order: { ...order, requiredTechCount: 2 } })).toMatchObject({
      canRequest: true,
      needsApproval: true,
    });
  });

  it('관할 밖이면 보이지도 않고 요청할 수 없다', () => {
    expect(checkSelfAssign({ ...ok, order: { ...order, legalDongCode: 'D9' } })).toMatchObject({
      visible: false,
      canRequest: false,
    });
  });
});

describe('F-TEC-RTE-04 [내 일정에 넣기] 활성 조건', () => {
  it('숙련이 단독 가능 이상이 아니면 막는다', () => {
    const r = checkSelfAssign({
      ...ok,
      tech: { ...tech, skills: [{ deviceType: 'WALL', skillLevel: 'CAN_ASSIST' }] },
    });
    expect(r.canRequest).toBe(false);
    expect(r.reasons).toContain('이 기기를 단독으로 작업할 숙련이 없습니다.');
    expect(checkSelfAssign({ ...ok, tech: { ...tech, skills: [] } }).canRequest).toBe(false);
  });

  it('그날 근무가 아니면 막는다', () => {
    expect(checkSelfAssign({ ...ok, working: false }).reasons).toContain('그날은 근무일이 아닙니다.');
  });

  it('코스에 넣으면 시간창을 어기면 막는다', () => {
    expect(checkSelfAssign({ ...ok, insertionOk: false }).reasons).toContain(
      '코스에 넣으면 도착 허용 시간을 지킬 수 없습니다.',
    );
  });

  it('자가 배정을 끄면 막는다', () => {
    expect(checkSelfAssign({ ...ok, enabled: false }).reasons).toContain(
      '거점에서 자가 배정을 사용하지 않습니다.',
    );
  });

  it('교육중·동행 미완료 견습 기사는 주기사로 담을 수 없다(BR-070·071)', () => {
    expect(checkSelfAssign({ ...ok, tech: { ...tech, status: 'TRAINING' } }).canRequest).toBe(false);
    expect(
      checkSelfAssign({ ...ok, tech: { ...tech, grade: 'TRAINEE', accompanyDoneCount: 1 } }).canRequest,
    ).toBe(false);
  });
});

describe('BR-115 위치는 동의 후 근무 중에만, 고객에게는 시각만', () => {
  it('위치정보 동의와 근무 시작이 모두 있어야 수집한다', () => {
    const now = new Date();
    expect(canCollectLocation({ locationAgreedAt: now, dutyStartedAt: now })).toBe(true);
    expect(canCollectLocation({ locationAgreedAt: null, dutyStartedAt: now })).toBe(false);
    expect(canCollectLocation({ locationAgreedAt: now, dutyStartedAt: null })).toBe(false);
  });

  it('고객에게는 확정 코스의 안내 시각만 주고 좌표는 주지 않는다', () => {
    const t = new Date('2026-12-02T10:40:00+09:00');
    const v = customerVisitTime({ orderStatus: 'ASSIGNED', routeStatus: 'CONFIRMED', notifiedArrival: t });
    expect(v).toEqual({ kind: 'PLANNED', at: t });
    expect(Object.keys(v!)).not.toContain('lat');
    expect(
      customerVisitTime({ orderStatus: 'ASSIGNED', routeStatus: 'DRAFT', notifiedArrival: t }),
    ).toBeNull();
    expect(
      customerVisitTime({ orderStatus: 'COMPLETED', routeStatus: 'CONFIRMED', notifiedArrival: t }),
    ).toBeNull();
    expect(
      customerVisitTime({ orderStatus: 'ASSIGNED', routeStatus: 'CONFIRMED', notifiedArrival: null }),
    ).toBeNull();
  });

  it('BR-115 이동중(ON_THE_WAY)이면 출발 때 계산한 도착 예정시각만 보여 준다(단계 5-1)', () => {
    const eta = new Date('2026-12-02T01:40:00Z');
    const v = customerVisitTime({ orderStatus: 'ON_THE_WAY', routeStatus: 'IN_PROGRESS', notifiedArrival: null, eta });
    expect(v).toEqual({ kind: 'ETA', at: eta });
    expect(customerVisitTime({ orderStatus: 'ON_THE_WAY', routeStatus: null, notifiedArrival: null, eta })).toEqual({ kind: 'ETA', at: eta });
    expect(customerVisitTime({ orderStatus: 'ON_THE_WAY', routeStatus: 'IN_PROGRESS', notifiedArrival: null, eta: null })).toBeNull();
    expect(customerVisitTime({ orderStatus: 'IN_PROGRESS', routeStatus: 'IN_PROGRESS', notifiedArrival: null, eta })).toBeNull();
  });
});
