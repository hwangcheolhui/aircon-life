import { describe, expect, it } from 'vitest';
import {
  type GeoPolygon,
  boundsOf,
  dongsInsidePolygon,
  estimateTravel,
  haversineMeters,
  hexagonAround,
  mergePolygons,
  pointInGeo,
  validateRing,
  zoneCoverage,
} from './geo';

const SEOUL_CITY_HALL = { lat: 37.5665, lng: 126.978 };
const GWANGHWAMUN = { lat: 37.5759, lng: 126.9768 };

describe('거리·이동시간 추정 (F-TEC-RTE-02 경로 API 실패 시 대체)', () => {
  it('시청~광화문 직선거리는 약 1km', () => {
    const m = haversineMeters(SEOUL_CITY_HALL, GWANGHWAMUN);
    expect(m).toBeGreaterThan(1000);
    expect(m).toBeLessThan(1100);
  });

  it('직선거리 ÷ 25km/h로 분 단위 이동시간을 올림 계산한다', () => {
    const t = estimateTravel(SEOUL_CITY_HALL, GWANGHWAMUN);
    // 1.05km ÷ 25km/h ≈ 2.5분 → 3분
    expect(t.minutes).toBe(3);
    expect(t.meters).toBe(Math.round(haversineMeters(SEOUL_CITY_HALL, GWANGHWAMUN)));
  });

  it('같은 지점은 0분 0m', () => {
    expect(estimateTravel(SEOUL_CITY_HALL, SEOUL_CITY_HALL)).toEqual({ minutes: 0, meters: 0 });
  });
});

describe('관할 경계 다각형 (F-ADM-DSP-08, F-TEC-MAP-02)', () => {
  const hex = hexagonAround(SEOUL_CITY_HALL, 600);

  it('법정동 중심의 육각형 경계는 닫힌 고리이고 중심을 포함한다', () => {
    const ring = hex.coordinates[0]!;
    expect(ring).toHaveLength(7);
    expect(ring[0]).toEqual(ring[6]);
    expect(pointInGeo(SEOUL_CITY_HALL, hex)).toBe(true);
    expect(pointInGeo(GWANGHWAMUN, hex)).toBe(false);
  });

  it('여러 법정동 경계를 MultiPolygon으로 합치고 각 중심을 포함한다', () => {
    const merged = mergePolygons([hex, hexagonAround(GWANGHWAMUN, 600)]);
    expect(merged?.type).toBe('MultiPolygon');
    expect(pointInGeo(GWANGHWAMUN, merged!)).toBe(true);
    expect(pointInGeo({ lat: 37.6, lng: 127.1 }, merged!)).toBe(false);
    expect(mergePolygons([])).toBeNull();
  });

  it('직접 그린 다각형은 꼭짓점 3개 이상이어야 한다', () => {
    expect(
      validateRing([
        [126.9, 37.5],
        [127, 37.5],
      ]),
    ).toBe('관할 구역은 지도에서 꼭짓점을 3개 이상 찍어야 합니다.');
    expect(
      validateRing([
        [126.9, 37.5],
        [127, 37.5],
        [127, 37.6],
      ]),
    ).toBeNull();
  });

  it('직접 그린 다각형 안에 중심이 들어가는 법정동만 관할 법정동이 된다', () => {
    const drawn: GeoPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [126.97, 37.56],
          [126.99, 37.56],
          [126.99, 37.57],
          [126.97, 37.57],
          [126.97, 37.56],
        ],
      ],
    };
    expect(
      dongsInsidePolygon(
        [
          { code: 'A', center: SEOUL_CITY_HALL },
          { code: 'B', center: GWANGHWAMUN },
        ],
        drawn,
      ),
    ).toEqual(['A']);
  });

  it('지도 범위는 모든 점을 감싼다', () => {
    const b = boundsOf([SEOUL_CITY_HALL, GWANGHWAMUN]);
    expect(b).toEqual({ minLat: 37.5665, maxLat: 37.5759, minLng: 126.9768, maxLng: 126.978 });
    expect(boundsOf([])).toBeNull();
  });
});

describe('기사 간 겹침·공백 (F-ADM-DSP-08)', () => {
  it('주 관할이 2명 이상인 법정동은 겹침, 주 관할이 없는 거점 법정동은 공백', () => {
    const r = zoneCoverage(
      ['D1', 'D2', 'D3'],
      [
        { technicianId: 1, code: 'D1', priority: 1 },
        { technicianId: 2, code: 'D1', priority: 1 },
        { technicianId: 2, code: 'D2', priority: 2 },
      ],
    );
    expect(r.overlaps).toEqual({ D1: [1, 2] });
    // D2는 보조 관할만 있으므로 공백, D3는 아무도 없음
    expect(r.gaps).toEqual(['D2', 'D3']);
  });
});
