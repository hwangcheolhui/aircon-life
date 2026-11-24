import { describe, expect, it } from 'vitest';
import { type LatLng, estimateTravel } from './geo';
import {
  type RouteStopInput,
  arrivalWindowOf,
  assertRouteTransition,
  bestInsertion,
  canConfirmRoute,
  computeSchedule,
  isAfterDeadline,
  optimizeRoute,
  routeConfirmDeadline,
} from './route-plan';

const at = (hhmm: string) => new Date(`2026-12-01T${hhmm}:00+09:00`);
// 동서로 늘어선 가상 지점 (경도 0.01° ≈ 880m)
const P = (i: number): LatLng => ({ lat: 37.6, lng: 126.9 + i * 0.01 });
const job = (
  key: string,
  i: number,
  win: [string, string] | null,
  workMin = 60,
  locked = false,
): RouteStopInput => ({
  key,
  type: 'JOB',
  point: P(i),
  windowStart: win ? at(win[0]) : null,
  windowEnd: win ? at(win[1]) : null,
  workMin,
  locked,
});
const base = {
  start: P(0),
  startAt: at('09:00'),
  travel: estimateTravel,
  bufferMin: 10,
  workEnd: at('18:00'),
};

describe('BR-114 도착 예정시각 = 직전 출발 + 이동시간 + 버퍼', () => {
  it('구간 이동시간·버퍼를 더해 지점별 도착·출발과 합계를 낸다', () => {
    const s = computeSchedule({ ...base, stops: [job('A', 1, null, 60), job('B', 2, null, 90)] });
    const leg = estimateTravel(P(0), P(1)).minutes; // 880m → 3분
    expect(s.stops[0]!.travelMin).toBe(leg);
    expect(s.stops[0]!.arrival).toEqual(new Date(at('09:00').getTime() + (leg + 10) * 60_000));
    expect(s.stops[0]!.departure).toEqual(new Date(s.stops[0]!.arrival.getTime() + 60 * 60_000));
    expect(s.stops[1]!.arrival).toEqual(new Date(s.stops[0]!.departure.getTime() + (leg + 10) * 60_000));
    expect(s.totalTravelMin).toBe(leg * 2);
    expect(s.totalWorkMin).toBe(150);
    expect(s.totalDistanceM).toBe(s.stops[0]!.distanceM + s.stops[1]!.distanceM);
    expect(s.violations).toBe(0);
    expect(s.overWorkEnd).toBe(false);
  });

  it('시간창보다 일찍 도착하면 시간창 시작까지 기다린 뒤 작업한다(위반 아님)', () => {
    const s = computeSchedule({ ...base, stops: [job('A', 1, ['11:00', '13:00'])] });
    expect(s.stops[0]!.arrival).toEqual(at('11:00'));
    expect(s.stops[0]!.waitMin).toBeGreaterThan(100);
    expect(s.stops[0]!.violation).toBe(false);
  });

  it('근무 종료시각을 넘는 코스는 경고한다', () => {
    const s = computeSchedule({ ...base, stops: [job('A', 1, null, 600)] });
    expect(s.overWorkEnd).toBe(true);
    expect(s.stops[0]!.overWorkEnd).toBe(true);
  });

  it('휴식 지점은 좌표가 없으면 직전 위치에서 쉬며 이동·버퍼가 없다', () => {
    const s = computeSchedule({
      ...base,
      stops: [
        job('A', 1, null, 60),
        {
          key: 'BRK',
          type: 'BREAK',
          point: null,
          windowStart: null,
          windowEnd: null,
          workMin: 60,
          locked: false,
        },
        job('B', 1, null, 30),
      ],
    });
    expect(s.stops[1]!.travelMin).toBe(0);
    expect(s.stops[1]!.arrival).toEqual(s.stops[0]!.departure);
    expect(s.stops[2]!.travelMin).toBe(0);
    expect(s.stops[2]!.arrival).toEqual(new Date(s.stops[1]!.departure.getTime() + 10 * 60_000));
  });
});

describe('BR-112 시간창 위반 시 확정 불가', () => {
  it('도착이 시간창 끝을 넘으면 위반 지점으로 표시되고 확정할 수 없다', () => {
    const s = computeSchedule({ ...base, stops: [job('A', 1, null, 240), job('B', 2, ['09:00', '11:00'])] });
    expect(s.stops[1]!.violation).toBe(true);
    expect(s.violations).toBe(1);
    expect(canConfirmRoute(s)).toEqual({
      ok: false,
      message:
        '도착 허용 시간을 벗어난 방문지가 1곳 있어 확정할 수 없습니다. 순서를 바꾸거나 거점에 일정 조정을 요청하세요.',
    });
  });

  it('위반이 없으면 확정할 수 있다', () => {
    const s = computeSchedule({ ...base, stops: [job('A', 1, ['09:00', '11:00'])] });
    expect(canConfirmRoute(s)).toEqual({ ok: true });
  });

  it('방문지가 없으면 확정할 수 없다', () => {
    expect(canConfirmRoute(computeSchedule({ ...base, stops: [] })).ok).toBe(false);
  });

  it('도착 허용 시간창 = 약속 시각부터 ARRIVAL_WINDOW_HOURS 시간 (이미 안내한 시간창이 있으면 그대로)', () => {
    expect(
      arrivalWindowOf({ promisedAt: at('10:00'), arrivalWindowStart: null, arrivalWindowEnd: null }, 2),
    ).toEqual({ start: at('10:00'), end: at('12:00') });
    expect(
      arrivalWindowOf(
        { promisedAt: at('10:00'), arrivalWindowStart: at('10:30'), arrivalWindowEnd: at('11:30') },
        2,
      ),
    ).toEqual({ start: at('10:30'), end: at('11:30') });
    expect(
      arrivalWindowOf({ promisedAt: null, arrivalWindowStart: null, arrivalWindowEnd: null }, 2),
    ).toBeNull();
  });
});

describe('F-TEC-RTE-02 코스 자동 추천', () => {
  it('지그재그 순서를 이동시간이 가장 짧은 순서로 바꾸고 전/후 절감량을 낸다', () => {
    const stops = [
      job('C', 3, null, 30),
      job('A', 1, null, 30),
      job('D', 4, null, 30),
      job('B', 2, null, 30),
    ];
    const r = optimizeRoute({ ...base, stops });
    expect(r.after.stops.map((s) => s.key)).toEqual(['A', 'B', 'C', 'D']);
    expect(r.after.totalTravelMin).toBeLessThan(r.before.totalTravelMin);
    expect(r.savedTravelMin).toBe(r.before.totalTravelMin - r.after.totalTravelMin);
    expect(r.savedDistanceM).toBeGreaterThan(0);
  });

  it('시간창을 지키는 것이 이동시간보다 우선이다', () => {
    // 가까운 A를 먼저 가면 B(멀리, 09:00~10:00)를 놓친다
    const stops = [job('A', 1, null, 120), job('B', 5, ['09:00', '10:00'], 30)];
    const r = optimizeRoute({ ...base, stops });
    expect(r.after.stops.map((s) => s.key)).toEqual(['B', 'A']);
    expect(r.after.violations).toBe(0);
  });

  it('순서 고정(🔒) 지점은 제자리를 지킨다', () => {
    const stops = [job('D', 4, null, 30, true), job('A', 1, null, 30), job('B', 2, null, 30)];
    const r = optimizeRoute({ ...base, stops });
    expect(r.after.stops[0]!.key).toBe('D');
  });

  it('모든 순서가 위반이면 위반이 가장 적은 순서를 제안한다', () => {
    const stops = [job('A', 1, ['09:00', '09:20'], 120), job('B', 2, ['09:00', '09:30'], 120)];
    const r = optimizeRoute({ ...base, stops });
    expect(r.after.violations).toBe(1);
    expect(r.unavoidable).toBe(true);
  });

  it('지점이 많으면(9곳 이상) 근사 탐색으로도 현재보다 나쁘지 않은 순서를 낸다', () => {
    const order = [5, 9, 1, 7, 3, 10, 2, 8, 4, 6];
    const stops = order.map((i) => job(`S${i}`, i, null, 10));
    const r = optimizeRoute({ ...base, stops });
    expect(r.after.totalTravelMin).toBeLessThanOrEqual(r.before.totalTravelMin);
    expect(r.after.stops.map((s) => s.key)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => `S${i}`));
  });
});

describe('F-TEC-RTE-04 코스 삽입 위치', () => {
  it('이동시간 증가가 가장 작은 위치에 넣는다', () => {
    const r = bestInsertion(
      { ...base, stops: [job('A', 1, null, 30), job('C', 3, null, 30)] },
      job('B', 2, null, 30),
    );
    expect(r.position).toBe(1);
    expect(r.schedule.stops.map((s) => s.key)).toEqual(['A', 'B', 'C']);
    expect(r.addedTravelMin).toBe(
      r.schedule.totalTravelMin -
        computeSchedule({ ...base, stops: [job('A', 1, null, 30), job('C', 3, null, 30)] }).totalTravelMin,
    );
    expect(r.ok).toBe(true);
  });

  it('어디에 넣어도 시간창을 어기면 ok=false', () => {
    const r = bestInsertion(
      { ...base, stops: [job('A', 1, ['09:00', '09:20'], 480)] },
      job('B', 2, ['09:00', '09:20'], 30),
    );
    expect(r.ok).toBe(false);
  });
});

describe('BR-113 코스 확정 마감', () => {
  it('다음 날 코스의 확정 마감은 전날 18:00(설정값, KST)', () => {
    expect(routeConfirmDeadline('2026-12-01', '18:00')).toEqual(new Date('2026-11-30T18:00:00+09:00'));
    expect(routeConfirmDeadline('2026-12-01', '17:30')).toEqual(new Date('2026-11-30T17:30:00+09:00'));
  });

  it('마감 시각이 지나면 마감 후로 본다', () => {
    const d = routeConfirmDeadline('2026-12-01', '18:00');
    expect(isAfterDeadline(new Date('2026-11-30T17:59:00+09:00'), d)).toBe(false);
    expect(isAfterDeadline(new Date('2026-11-30T18:00:00+09:00'), d)).toBe(true);
  });
});

describe('코스 상태 전이 (01 §3.6)', () => {
  it('DRAFT → OPTIMIZED → CONFIRMED, 확정 후 재편집은 DRAFT로', () => {
    expect(() => assertRouteTransition('DRAFT', 'OPTIMIZED')).not.toThrow();
    expect(() => assertRouteTransition('OPTIMIZED', 'CONFIRMED')).not.toThrow();
    expect(() => assertRouteTransition('DRAFT', 'CONFIRMED')).not.toThrow();
    expect(() => assertRouteTransition('CONFIRMED', 'DRAFT')).not.toThrow();
  });

  it('없는 전이는 막는다', () => {
    expect(() => assertRouteTransition('DONE', 'DRAFT')).toThrow();
    expect(() => assertRouteTransition('DRAFT', 'DONE')).toThrow();
  });
});
