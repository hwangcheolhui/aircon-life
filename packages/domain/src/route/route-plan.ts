/**
 * 기사 일자별 방문 코스 (단계 4-2: F-TEC-RTE-01~04, F-SYS-15·16, 01 §2.8.4·2.8.5·§3.6).
 * - BR-114: 지점 도착 예정 = 직전 출발 + 이동시간 + 버퍼(ROUTE_TRAVEL_BUFFER_MIN). 근무 종료시각을 넘으면 경고.
 * - BR-112: 도착이 시간창(arrival_window) 끝을 넘으면 위반. 위반이 있으면 확정 불가. 시간창보다 일찍 오면 시작까지 기다린다.
 * - BR-113: 다음 날 코스 확정 마감 = 전날 ROUTE_CONFIRM_DEADLINE(18:00) KST.
 * - 자동 추천: 위반 수 → 총 이동시간 → 총 거리 순으로 가장 좋은 순서. 순서 고정 지점은 제자리.
 *   자유 지점 8곳 이하는 전수 탐색, 그 이상은 최근접 + 2-opt 근사.
 * 이동시간은 호출하는 쪽이 넘긴 travel 함수(경로 API 또는 직선거리 추정)로 계산한다.
 */
import type { LatLng, TravelLeg } from './geo';

export const STOP_TYPES = ['JOB', 'BREAK', 'MATERIAL', 'BRANCH'] as const;
export type StopType = (typeof STOP_TYPES)[number];

export interface RouteStopInput {
  /** 화면·저장에서 지점을 구분하는 키 (작업은 `A{assignmentId}`, 휴식 등은 `S{routeStopId}`·임시 키) */
  key: string;
  type: StopType;
  /** null 이면 직전 위치에서 머문다(휴식) */
  point: LatLng | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  workMin: number;
  locked: boolean;
}

export type TravelFn = (a: LatLng, b: LatLng) => TravelLeg;

export interface ScheduleInput {
  start: LatLng;
  startAt: Date;
  stops: readonly RouteStopInput[];
  travel: TravelFn;
  /** BR-114 ROUTE_TRAVEL_BUFFER_MIN */
  bufferMin: number;
  /** 근무 종료시각 (없으면 검사 안 함) */
  workEnd: Date | null;
}

export interface ScheduledStop extends RouteStopInput {
  seq: number;
  travelMin: number;
  distanceM: number;
  /** 계획 도착(시간창보다 일찍 오면 시간창 시작) */
  arrival: Date;
  departure: Date;
  waitMin: number;
  /** BR-112 시간창 위반 */
  violation: boolean;
  /** BR-114 근무 종료 초과 */
  overWorkEnd: boolean;
}

export interface RouteSchedule {
  stops: ScheduledStop[];
  totalTravelMin: number;
  totalDistanceM: number;
  totalWorkMin: number;
  violations: number;
  overWorkEnd: boolean;
  finishAt: Date | null;
}

const MIN = 60_000;

export function computeSchedule(i: ScheduleInput): RouteSchedule {
  let pos = i.start;
  let clock = i.startAt.getTime();
  const out: ScheduledStop[] = [];
  let totalTravelMin = 0;
  let totalDistanceM = 0;
  let totalWorkMin = 0;
  i.stops.forEach((s, idx) => {
    const moves = s.point !== null;
    const leg = moves ? i.travel(pos, s.point!) : { minutes: 0, meters: 0 };
    const reach = clock + (moves ? (leg.minutes + i.bufferMin) * MIN : 0);
    const startWork = s.windowStart && reach < s.windowStart.getTime() ? s.windowStart.getTime() : reach;
    const departure = startWork + s.workMin * MIN;
    const violation = Boolean(s.windowEnd && startWork > s.windowEnd.getTime());
    const overWorkEnd = Boolean(i.workEnd && departure > i.workEnd.getTime());
    out.push({
      ...s,
      seq: idx + 1,
      travelMin: leg.minutes,
      distanceM: leg.meters,
      arrival: new Date(startWork),
      departure: new Date(departure),
      waitMin: Math.round((startWork - reach) / MIN),
      violation,
      overWorkEnd,
    });
    totalTravelMin += leg.minutes;
    totalDistanceM += leg.meters;
    totalWorkMin += s.workMin;
    clock = departure;
    if (moves) pos = s.point!;
  });
  return {
    stops: out,
    totalTravelMin,
    totalDistanceM,
    totalWorkMin,
    violations: out.filter((s) => s.violation).length,
    overWorkEnd: out.some((s) => s.overWorkEnd),
    finishAt: out.length ? out[out.length - 1]!.departure : null,
  };
}

/** BR-112 확정 가능 여부 */
export function canConfirmRoute(s: RouteSchedule): { ok: true } | { ok: false; message: string } {
  if (!s.stops.some((x) => x.type === 'JOB')) return { ok: false, message: '확정할 방문지가 없습니다.' };
  if (s.violations > 0)
    return {
      ok: false,
      message: `도착 허용 시간을 벗어난 방문지가 ${s.violations}곳 있어 확정할 수 없습니다. 순서를 바꾸거나 거점에 일정 조정을 요청하세요.`,
    };
  return { ok: true };
}

/** BR-112 도착 허용 시간창: 이미 안내한 시간창이 있으면 그대로, 없으면 약속 시각 ~ +ARRIVAL_WINDOW_HOURS */
export function arrivalWindowOf(
  o: { promisedAt: Date | null; arrivalWindowStart: Date | null; arrivalWindowEnd: Date | null },
  hours: number,
): { start: Date; end: Date } | null {
  if (o.arrivalWindowStart && o.arrivalWindowEnd)
    return { start: o.arrivalWindowStart, end: o.arrivalWindowEnd };
  if (!o.promisedAt) return null;
  return { start: o.promisedAt, end: new Date(o.promisedAt.getTime() + hours * 3600_000) };
}

/* ---------- 비교 ---------- */

type Score = [number, number, number];
const scoreOf = (s: RouteSchedule): Score => [s.violations, s.totalTravelMin, s.totalDistanceM];
const better = (a: Score, b: Score) =>
  a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

/* ---------- F-TEC-RTE-02 자동 추천 ---------- */

export const EXACT_SEARCH_MAX = 8;

export interface OptimizeResult {
  before: RouteSchedule;
  after: RouteSchedule;
  savedTravelMin: number;
  savedDistanceM: number;
  /** 어떤 순서로도 시간창 위반을 없앨 수 없음 → "운영자에게 일정 조정 요청" */
  unavoidable: boolean;
}

export function optimizeRoute(i: ScheduleInput): OptimizeResult {
  const before = computeSchedule(i);
  const freeIdx = i.stops.map((s, k) => (s.locked ? -1 : k)).filter((k) => k >= 0);
  const free = freeIdx.map((k) => i.stops[k]!);
  const build = (perm: readonly RouteStopInput[]) => {
    const arr = [...i.stops];
    freeIdx.forEach((k, n) => (arr[k] = perm[n]!));
    return arr;
  };
  const evalPerm = (perm: readonly RouteStopInput[]) => computeSchedule({ ...i, stops: build(perm) });

  let best = before;
  let bestScore = scoreOf(before);
  const consider = (perm: readonly RouteStopInput[]) => {
    const s = evalPerm(perm);
    const sc = scoreOf(s);
    if (better(sc, bestScore)) {
      best = s;
      bestScore = sc;
    }
  };

  if (free.length <= EXACT_SEARCH_MAX) {
    permute(free, consider);
  } else {
    // 최근접 이웃으로 시작 → 2-opt (자유 지점끼리만)
    const remaining = [...free];
    const seq: RouteStopInput[] = [];
    let pos = i.start;
    while (remaining.length) {
      let bi = 0;
      let bd = Infinity;
      remaining.forEach((s, k) => {
        const d = s.point ? i.travel(pos, s.point).meters : 0;
        if (d < bd) {
          bd = d;
          bi = k;
        }
      });
      const [next] = remaining.splice(bi, 1);
      seq.push(next!);
      if (next!.point) pos = next!.point;
    }
    let cur = seq;
    let curScore = scoreOf(evalPerm(cur));
    let improved = true;
    while (improved) {
      improved = false;
      for (let a = 0; a < cur.length - 1; a++) {
        for (let b = a + 1; b < cur.length; b++) {
          const cand = [...cur.slice(0, a), ...cur.slice(a, b + 1).reverse(), ...cur.slice(b + 1)];
          const sc = scoreOf(evalPerm(cand));
          if (better(sc, curScore)) {
            cur = cand;
            curScore = sc;
            improved = true;
          }
        }
      }
    }
    consider(cur);
  }
  return {
    before,
    after: best,
    savedTravelMin: before.totalTravelMin - best.totalTravelMin,
    savedDistanceM: before.totalDistanceM - best.totalDistanceM,
    unavoidable: best.violations > 0,
  };
}

function permute<T>(items: readonly T[], visit: (perm: readonly T[]) => void) {
  const a = [...items];
  const c = new Array<number>(a.length).fill(0);
  visit(a);
  let k = 0;
  while (k < a.length) {
    if (c[k]! < k) {
      const j = k % 2 === 0 ? 0 : c[k]!;
      [a[j], a[k]] = [a[k]!, a[j]!];
      visit(a);
      c[k]! += 1;
      k = 0;
    } else {
      c[k] = 0;
      k++;
    }
  }
}

/* ---------- F-TEC-RTE-04 삽입 위치 ---------- */

export interface InsertionResult {
  position: number;
  schedule: RouteSchedule;
  addedTravelMin: number;
  /** 넣어도 기존·새 지점 모두 시간창을 지키는지 */
  ok: boolean;
}

/** 이동시간 증가가 가장 작은 위치(위반이 없는 위치 우선) */
export function bestInsertion(i: ScheduleInput, stop: RouteStopInput): InsertionResult {
  const baseTravel = computeSchedule(i).totalTravelMin;
  let best: InsertionResult | null = null;
  for (let p = 0; p <= i.stops.length; p++) {
    const stops = [...i.stops.slice(0, p), stop, ...i.stops.slice(p)];
    const s = computeSchedule({ ...i, stops });
    const cand: InsertionResult = {
      position: p,
      schedule: s,
      addedTravelMin: s.totalTravelMin - baseTravel,
      ok: s.violations === 0,
    };
    if (!best || better(scoreOf(cand.schedule), scoreOf(best.schedule))) best = cand;
  }
  return best!;
}

/* ---------- BR-113 확정 마감 ---------- */

/** 코스일 전날 hh:mm (KST) */
export function routeConfirmDeadline(planDate: string, hhmm: string): Date {
  const d = new Date(`${planDate}T00:00:00+09:00`);
  const prev = new Date(d.getTime() - 24 * 3600_000);
  const ymd = new Date(prev.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  return new Date(`${ymd}T${hhmm.slice(0, 5)}:00+09:00`);
}

export const isAfterDeadline = (now: Date, deadline: Date) => now.getTime() >= deadline.getTime();

/* ---------- 01 §3.6 코스 상태 ---------- */

export const ROUTE_STATUSES = ['DRAFT', 'OPTIMIZED', 'CONFIRMED', 'IN_PROGRESS', 'DONE'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const ROUTE_TRANSITIONS: Readonly<Record<RouteStatus, readonly RouteStatus[]>> = {
  DRAFT: ['OPTIMIZED', 'CONFIRMED'],
  OPTIMIZED: ['DRAFT', 'CONFIRMED'],
  // 마감 전 재편집 또는 운영자 배정 변경으로 다시 작성중
  CONFIRMED: ['DRAFT', 'IN_PROGRESS'],
  IN_PROGRESS: ['DONE'],
  DONE: [],
};

export function canTransitionRoute(from: string, to: RouteStatus): boolean {
  return (ROUTE_TRANSITIONS[from as RouteStatus] ?? []).includes(to);
}

export function assertRouteTransition(from: string, to: RouteStatus): void {
  if (!canTransitionRoute(from, to)) throw new Error(`코스 상태를 ${from}에서 ${to}(으)로 바꿀 수 없습니다.`);
}

/** 확정된(고객 안내가 나간) 코스 */
export const isConfirmedRoute = (status: string) =>
  status === 'CONFIRMED' || status === 'IN_PROGRESS' || status === 'DONE';
