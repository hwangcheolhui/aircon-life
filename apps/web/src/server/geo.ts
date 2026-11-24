import 'server-only';
/**
 * 좌표 준비 (단계 4-2). 고객 주소·거점 법정동의 좌표를 지오코딩 어댑터(GEO_DRIVER, 기본 mock)로 채운다.
 * - 고객 주소 좌표(customer_address.lat/lng)는 지도·코스가 처음 필요할 때 채우고 저장한다(접수 화면은 그대로).
 * - 이동시간은 경로 API 실연동 전까지 직선거리 ÷ 25km/h(estimateTravel, F-TEC-RTE-02 예외 규칙)로 계산한다.
 * - 법정동 근사 경계: 동 중심 둘레 ZONE_DONG_RADIUS_M 육각형(법정동 경계 데이터를 붙이기 전).
 */
import { branch, customerAddress, serviceArea } from '@aircon/db';
import { type LatLng, SETTING_KEYS, type TravelFn, estimateTravel } from '@aircon/domain';
import { createGeoAdapter } from '@aircon/integrations';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from './db';
import { getSettingNumber } from './settings';

/** 지점 간 이동시간 (경로 API 붙이기 전: 직선거리 추정) */
export const travel: TravelFn = (a, b) => estimateTravel(a, b);

const num = (v: string | null) => (v === null ? null : Number(v));
export const toLatLng = (lat: string | null, lng: string | null): LatLng | null => {
  const a = num(lat);
  const b = num(lng);
  return a === null || b === null || Number.isNaN(a) || Number.isNaN(b) ? null : { lat: a, lng: b };
};

/** 주소 id → 좌표. 비어 있으면 지오코딩해 저장한다. 못 찾으면 결과에서 빠진다 */
export async function ensureAddressCoords(addressIds: number[]): Promise<Map<number, LatLng>> {
  const out = new Map<number, LatLng>();
  if (addressIds.length === 0) return out;
  const db = getDb();
  const rows = await db
    .select({
      id: customerAddress.id,
      lat: customerAddress.lat,
      lng: customerAddress.lng,
      road: customerAddress.roadAddress,
      code: customerAddress.legalDongCode,
    })
    .from(customerAddress)
    .where(inArray(customerAddress.id, [...new Set(addressIds)]));
  const geo = createGeoAdapter();
  for (const r of rows) {
    const known = toLatLng(r.lat, r.lng);
    if (known) {
      out.set(r.id, known);
      continue;
    }
    const p = await geo.geocode({ roadAddress: r.road, legalDongCode: r.code });
    if (!p) continue;
    await db
      .update(customerAddress)
      .set({ lat: p.lat.toFixed(7), lng: p.lng.toFixed(7) })
      .where(eq(customerAddress.id, r.id));
    out.set(r.id, p);
  }
  return out;
}

export interface BranchDong {
  code: string;
  label: string;
  center: LatLng;
}

/** 거점의 서비스 법정동과 중심 좌표 */
export async function branchDongs(branchId: number): Promise<BranchDong[]> {
  const rows = await getDb()
    .select({
      code: serviceArea.legalDongCode,
      sido: serviceArea.sido,
      sigungu: serviceArea.sigungu,
      dong: serviceArea.eupmyeondong,
    })
    .from(serviceArea)
    .where(and(eq(serviceArea.branchId, branchId), eq(serviceArea.isServiceable, true)))
    .orderBy(asc(serviceArea.sigungu), asc(serviceArea.eupmyeondong));
  const geo = createGeoAdapter();
  const out: BranchDong[] = [];
  for (const r of rows) {
    if (!r.code) continue;
    const center = await geo.dongCenter(r.code, `${r.sido} ${r.sigungu} ${r.dong}`);
    if (center) out.push({ code: r.code, label: `${r.sigungu} ${r.dong}`, center });
  }
  return out;
}

/** 거점 중심 좌표(코스 출발지). 거점에 좌표가 없으면 서비스 법정동 중심의 평균(저장하지 않음), 그것도 없으면 null */
export async function branchCenter(branchId: number): Promise<LatLng | null> {
  const [b] = await getDb()
    .select({ lat: branch.centerLat, lng: branch.centerLng })
    .from(branch)
    .where(and(eq(branch.id, branchId), isNull(branch.deletedAt)));
  const known = b ? toLatLng(b.lat, b.lng) : null;
  if (known) return known;
  const dongs = await branchDongs(branchId);
  if (!dongs.length) return null;
  return {
    lat: dongs.reduce((s, d) => s + d.center.lat, 0) / dongs.length,
    lng: dongs.reduce((s, d) => s + d.center.lng, 0) / dongs.length,
  };
}

export const dongRadius = () => getSettingNumber(SETTING_KEYS.ZONE_DONG_RADIUS_M);
