import { describe, expect, it } from 'vitest';
import { busyUntilOf, nextStopDelay, recalcEtas } from './eta';

const t = (hhmm: string) => new Date(`2026-11-26T${hhmm}:00+09:00`);
const A = { lat: 37.5, lng: 127.0 };
// 약 2.2km 북쪽 → 25km/h 로 6분
const B = { lat: 37.52, lng: 127.0 };

describe('진행 중 ETA 재계산 (F-TEC-RTE-06, BR-114)', () => {
  it('BR-114 지금 위치에서 이동시간 + 버퍼, 작업시간을 더해 다음 정류장으로', () => {
    const r = recalcEtas({
      now: t('10:00'),
      origin: A,
      busyUntil: null,
      bufferMin: 10,
      stops: [
        { id: 1, point: B, workMin: 60, windowStart: null, plannedArrival: t('10:10'), notifiedArrival: null },
        { id: 2, point: A, workMin: 60, windowStart: null, plannedArrival: t('11:30'), notifiedArrival: t('11:20') },
      ],
    });
    expect(r[0]!.eta).toEqual(t('10:16'));
    expect(r[0]!.delayMin).toBe(6);
    expect(r[1]!.eta).toEqual(t('11:32'));
    expect(r[1]!.delayMin).toBe(12); // 안내 시각(11:20) 기준
  });
  it('진행 중 작업이 늦게 끝나면 그 뒤로 밀리고, 시간창 시작 전이면 시간창 시작', () => {
    const r = recalcEtas({
      now: t('10:00'),
      origin: A,
      busyUntil: t('11:00'),
      bufferMin: 0,
      stops: [{ id: 1, point: A, workMin: 30, windowStart: t('12:00'), plannedArrival: t('12:00'), notifiedArrival: null }],
    });
    expect(r[0]!.eta).toEqual(t('12:00'));
    expect(r[0]!.delayMin).toBe(0);
  });
  it('위치를 모르면 이동시간 0으로 본다', () => {
    const r = recalcEtas({ now: t('10:00'), origin: null, busyUntil: null, bufferMin: 10, stops: [{ id: 1, point: B, workMin: 0, windowStart: null, plannedArrival: null, notifiedArrival: null }] });
    expect(r[0]!.eta).toEqual(t('10:00'));
    expect(r[0]!.delayMin).toBeNull();
  });
  it('작업 예상 종료 = 시작 + 예상 작업시간, 이미 지났으면 지금', () => {
    expect(busyUntilOf(t('09:00'), 90, t('10:00'))).toEqual(t('10:30'));
    expect(busyUntilOf(t('09:00'), 30, t('10:00'))).toEqual(t('10:00'));
    expect(busyUntilOf(null, 30, t('10:00'))).toBeNull();
  });
  it('다음 고객이 30분 이상 늦을 때만 지연 알림', () => {
    expect(nextStopDelay([{ id: 1, eta: t('10:40'), delayMin: 30 }], 30)?.id).toBe(1);
    expect(nextStopDelay([{ id: 1, eta: t('10:40'), delayMin: 29 }, { id: 2, eta: t('12:00'), delayMin: 90 }], 30)).toBeNull();
    expect(nextStopDelay([], 30)).toBeNull();
  });
});
