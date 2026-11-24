/**
 * 좌표·경계 계산 (단계 4-2). 지도 SDK·경로 API와 무관한 순수 함수만 둔다.
 * - 이동시간 추정: 경로 API가 없거나 실패하면 직선거리 ÷ 평균속도 25km/h (F-TEC-RTE-02 예외, CLAUDE.md §7)
 * - 관할 경계: GeoJSON Polygon/MultiPolygon (01 §2.7.3-1 technician_zone.boundary_geojson). 좌표 순서는 GeoJSON 규약대로 [경도, 위도].
 * - 관할 판단은 경계가 아니라 technician_area 법정동 일치로 한다(01 §2.7.3). 경계는 지도 표시용이다.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** [경도, 위도] */
export type Position = [number, number];
export interface GeoPolygon {
  type: 'Polygon';
  coordinates: Position[][];
}
export interface GeoMultiPolygon {
  type: 'MultiPolygon';
  coordinates: Position[][][];
}
export type GeoShape = GeoPolygon | GeoMultiPolygon;

export interface TravelLeg {
  minutes: number;
  meters: number;
}

/** F-TEC-RTE-02 대체 추정 평균속도(km/h) — 기능정의서에 고정된 추정식 값 */
export const FALLBACK_SPEED_KMH = 25;

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 직선거리 ÷ 25km/h 이동시간(분, 올림) */
export function estimateTravel(a: LatLng, b: LatLng, speedKmh = FALLBACK_SPEED_KMH): TravelLeg {
  const meters = Math.round(haversineMeters(a, b));
  return { meters, minutes: Math.ceil(meters / 1000 / speedKmh * 60) };
}

/** 중심에서 반경(m)인 육각형 (법정동 경계 데이터를 붙이기 전의 근사 경계) */
export function hexagonAround(center: LatLng, radiusM: number): GeoPolygon {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos(rad(center.lat)));
  const ring: Position[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    ring.push([round7(center.lng + dLng * Math.cos(a)), round7(center.lat + dLat * Math.sin(a))]);
  }
  ring.push(ring[0]!);
  return { type: 'Polygon', coordinates: [ring] };
}

const round7 = (n: number) => Math.round(n * 1e7) / 1e7;

/** 여러 다각형을 MultiPolygon 하나로 (겹침 정리는 하지 않음 — 표시용) */
export function mergePolygons(shapes: readonly GeoShape[]): GeoMultiPolygon | null {
  const polys: Position[][][] = [];
  for (const s of shapes) {
    if (s.type === 'Polygon') polys.push(s.coordinates);
    else polys.push(...s.coordinates);
  }
  return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
}

/** 지도에 찍은 꼭짓점 → 닫힌 고리 검증. 오류 문구 또는 null */
export function validateRing(points: readonly Position[]): string | null {
  const open = points.length > 1 && samePos(points[0]!, points[points.length - 1]!) ? points.slice(0, -1) : points;
  if (open.length < 3) return '관할 구역은 지도에서 꼭짓점을 3개 이상 찍어야 합니다.';
  return null;
}

const samePos = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/** 꼭짓점 목록 → 닫힌 Polygon */
export function polygonFromPoints(points: readonly Position[]): GeoPolygon {
  const ring = points.map((p) => [round7(p[0]), round7(p[1])] as Position);
  if (ring.length && !samePos(ring[0]!, ring[ring.length - 1]!)) ring.push(ring[0]!);
  return { type: 'Polygon', coordinates: [ring] };
}

function inRing(p: LatLng, ring: readonly Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(p: LatLng, rings: readonly Position[][]): boolean {
  if (!rings[0] || !inRing(p, rings[0])) return false;
  return !rings.slice(1).some((hole) => inRing(p, hole));
}

/** 점이 경계 안에 있는지 */
export function pointInGeo(p: LatLng, shape: GeoShape): boolean {
  if (shape.type === 'Polygon') return inPolygon(p, shape.coordinates);
  return shape.coordinates.some((poly) => inPolygon(p, poly));
}

/** 직접 그린 구역(DRAWN): 중심이 다각형 안에 들어가는 법정동 코드 → technician_area */
export function dongsInsidePolygon(dongs: readonly { code: string; center: LatLng }[], shape: GeoShape): string[] {
  return dongs.filter((d) => pointInGeo(d.center, shape)).map((d) => d.code);
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function boundsOf(points: readonly LatLng[]): Bounds | null {
  if (points.length === 0) return null;
  return points.reduce<Bounds>(
    (b, p) => ({ minLat: Math.min(b.minLat, p.lat), maxLat: Math.max(b.maxLat, p.lat), minLng: Math.min(b.minLng, p.lng), maxLng: Math.max(b.maxLng, p.lng) }),
    { minLat: points[0]!.lat, maxLat: points[0]!.lat, minLng: points[0]!.lng, maxLng: points[0]!.lng },
  );
}

/** 경계의 모든 꼭짓점 (지도 범위 계산용) */
export function shapePoints(shape: GeoShape): LatLng[] {
  const polys = shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates;
  return polys.flatMap((poly) => (poly[0] ?? []).map(([lng, lat]) => ({ lat, lng })));
}

/** 경계 중심(꼭짓점 평균) */
export function shapeCenter(shape: GeoShape): LatLng | null {
  const pts = shapePoints(shape);
  if (!pts.length) return null;
  return { lat: round7(pts.reduce((s, p) => s + p.lat, 0) / pts.length), lng: round7(pts.reduce((s, p) => s + p.lng, 0) / pts.length) };
}

/** 저장된 JSON → 경계 (형식이 다르면 null) */
export function parseShape(v: unknown): GeoShape | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as { type?: unknown; coordinates?: unknown };
  if ((s.type === 'Polygon' || s.type === 'MultiPolygon') && Array.isArray(s.coordinates)) return s as GeoShape;
  return null;
}

/**
 * 기사 간 겹침·공백 (F-ADM-DSP-08): 거점 서비스 법정동 중
 * - 겹침: 주 관할(priority 1)이 2명 이상
 * - 공백: 주 관할 기사가 없음(보조 관할만 있어도 공백)
 */
export function zoneCoverage(
  branchDongs: readonly string[],
  areas: readonly { technicianId: number; code: string; priority: number }[],
): { overlaps: Record<string, number[]>; gaps: string[] } {
  const primary = new Map<string, number[]>();
  for (const a of areas) {
    if (a.priority !== 1) continue;
    const list = primary.get(a.code) ?? [];
    if (!list.includes(a.technicianId)) list.push(a.technicianId);
    primary.set(a.code, list);
  }
  const overlaps: Record<string, number[]> = {};
  for (const [code, ids] of primary) if (ids.length > 1) overlaps[code] = [...ids].sort((x, y) => x - y);
  return { overlaps, gaps: branchDongs.filter((d) => !primary.has(d)) };
}
