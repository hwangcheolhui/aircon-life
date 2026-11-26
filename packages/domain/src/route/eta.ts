/**
 * 진행 중 도착 예정 갱신 (F-TEC-RTE-06, F-SYS-17, 단계 9) · 코스 모니터링 지연 표시(F-ADM-DSP-09).
 * 근무 중 위치·실제 작업 종료시각으로 남은 정류장 ETA 를 다시 계산한다.
 * - 출발 시각 = max(지금, 진행 중 작업 예상 종료)
 * - 이동시간 = 직선거리 ÷ 25km/h(경로 API 실연동 전, F-TEC-RTE-02) + 이동 버퍼(BR-114). 시간창 시작 전 도착이면 시간창 시작
 * - 지연 = ETA − 고객에게 안내한 도착 시각(없으면 계획 도착). 다음 고객이 ETA_DELAY_ALERT_MIN(30)분 이상 늦으면 기사에게 알린다
 * 고객에게는 좌표가 아니라 시각만 보낸다(BR-115).
 */
import { type LatLng, estimateTravel } from './geo';

export interface EtaStop {
  id: number;
  point: LatLng | null;
  workMin: number;
  windowStart: Date | null;
  plannedArrival: Date | null;
  notifiedArrival: Date | null;
}

export interface EtaResult {
  id: number;
  eta: Date;
  /** 안내(또는 계획) 시각 대비 늦는 분. 일찍이면 음수 */
  delayMin: number | null;
}

const MIN = 60_000;

export function recalcEtas(i: {
  now: Date;
  /** 현재 위치(없으면 첫 정류장까지 이동시간을 모름 → 0분) */
  origin: LatLng | null;
  /** 진행 중 작업이 끝날 예상 시각 */
  busyUntil: Date | null;
  /** 남은 정류장(방문 순서대로) */
  stops: readonly EtaStop[];
  bufferMin: number;
}): EtaResult[] {
  let clock = Math.max(i.now.getTime(), i.busyUntil?.getTime() ?? 0);
  let pos = i.origin;
  return i.stops.map((s) => {
    const moves = Boolean(pos && s.point);
    const leg = moves ? estimateTravel(pos!, s.point!).minutes + i.bufferMin : 0;
    let arrive = clock + leg * MIN;
    if (s.windowStart && arrive < s.windowStart.getTime()) arrive = s.windowStart.getTime();
    clock = arrive + s.workMin * MIN;
    if (s.point) pos = s.point;
    const ref = s.notifiedArrival ?? s.plannedArrival;
    return { id: s.id, eta: new Date(arrive), delayMin: ref ? Math.round((arrive - ref.getTime()) / MIN) : null };
  });
}

/** 진행 중 작업 예상 종료: 시작(또는 도착) 시각 + 예상 작업시간. 이미 지났으면 지금 */
export function busyUntilOf(startedAt: Date | null, workMin: number, now: Date): Date | null {
  if (!startedAt) return null;
  const end = startedAt.getTime() + workMin * MIN;
  return new Date(Math.max(end, now.getTime()));
}

/** 다음 고객(첫 남은 정류장)이 임계값 이상 늦는지 */
export function nextStopDelay(etas: readonly EtaResult[], thresholdMin: number): EtaResult | null {
  const next = etas[0];
  return next && next.delayMin !== null && next.delayMin >= thresholdMin ? next : null;
}
