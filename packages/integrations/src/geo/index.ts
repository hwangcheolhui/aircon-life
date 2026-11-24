/**
 * 지오코딩(주소 → 좌표)·법정동 중심 (단계 4-2: 출동 지도 F-TEC-MAP-01, 관할 구역 F-ADM-DSP-08, 코스 F-TEC-RTE-01). 02 §6, CLAUDE.md §7.
 * - Mock(기본): 외부 호출 없이 법정동 코드로 정한 중심 + 주소 문자열로 정한 작은 오프셋. 같은 주소는 항상 같은 좌표다.
 *   예시 주소(MOCK_ADDRESSES)의 법정동은 실제 동 중심 근처 좌표를 쓰고, 그 밖의 코드는 서울시청 주변에 흩어 놓는다.
 * - Real(kakao): 카카오 로컬 API 주소 검색(REST 키 KAKAO_REST_API_KEY, 서버 전용). 실패하면 null → 호출하는 쪽이 거점 중심으로 대신한다.
 * 전환: GEO_DRIVER=mock|kakao (기본 mock).
 * 이동시간은 아직 경로 API를 붙이지 않고 packages/domain estimateTravel(직선거리 ÷ 25km/h)로 계산한다(04 단계 4-2 "처음엔 직선거리 추정").
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeocodeQuery {
  roadAddress: string;
  legalDongCode: string | null;
}

export type GeoDriver = 'mock' | 'kakao';

export interface GeoAdapter {
  kind: GeoDriver;
  /** 도로명 주소 → 좌표 (못 찾으면 null) */
  geocode(q: GeocodeQuery): Promise<GeoPoint | null>;
  /** 법정동 중심 (label 예: "서울특별시 은평구 불광동") */
  dongCenter(legalDongCode: string, label: string): Promise<GeoPoint | null>;
}

export const resolveGeoDriver = (v: string | undefined): GeoDriver => (v === 'kakao' ? 'kakao' : 'mock');

/* ---------- Mock ---------- */

/** 예시 주소 법정동의 대략적 중심 (공개 지도 기준 동 중심 부근, 개인 주소 아님) */
const MOCK_DONG_CENTERS: Record<string, GeoPoint> = {
  '1138010400': { lat: 37.6177, lng: 126.9288 }, // 은평구 불광동
  '1138010500': { lat: 37.6142, lng: 126.9201 }, // 은평구 대조동
  '1138010300': { lat: 37.6106, lng: 126.9161 }, // 은평구 역촌동
  '1138010600': { lat: 37.6251, lng: 126.9223 }, // 은평구 갈현동
  '1138010200': { lat: 37.6029, lng: 126.9124 }, // 은평구 응암동
  '4113511000': { lat: 37.3925, lng: 127.1112 }, // 분당구 백현동
  '2823710100': { lat: 37.4925, lng: 126.7244 }, // 부평구 부평동
  '2635010500': { lat: 35.1631, lng: 129.1636 }, // 해운대구 우동
};

const BASE: GeoPoint = { lat: 37.5665, lng: 126.978 };

/** 문자열 → [0,1) 두 개 (FNV-1a) */
function hash2(s: string): [number, number] {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return [h1 / 2 ** 32, h2 / 2 ** 32];
}

const r7 = (n: number) => Math.round(n * 1e7) / 1e7;

export function mockDongCenter(code: string): GeoPoint {
  const known = MOCK_DONG_CENTERS[code];
  if (known) return known;
  const [a, b] = hash2(code);
  return { lat: r7(BASE.lat + (a - 0.5) * 0.16), lng: r7(BASE.lng + (b - 0.5) * 0.2) };
}

export function createMockGeoAdapter(): GeoAdapter {
  return {
    kind: 'mock',
    async geocode(q) {
      const c = q.legalDongCode ? mockDongCenter(q.legalDongCode) : BASE;
      const [a, b] = hash2(q.roadAddress);
      // 동 중심에서 약 ±400m 안
      return { lat: r7(c.lat + (a - 0.5) * 0.007), lng: r7(c.lng + (b - 0.5) * 0.009) };
    },
    async dongCenter(code) {
      return mockDongCenter(code);
    },
  };
}

/* ---------- Real: 카카오 로컬 ---------- */

export const KAKAO_LOCAL_ADDRESS_URL = 'https://dapi.kakao.com/v2/local/search/address.json';

export function createKakaoGeoAdapter(restKey: string, fetchImpl: typeof fetch = fetch): GeoAdapter {
  const search = async (query: string): Promise<GeoPoint | null> => {
    try {
      const res = await fetchImpl(`${KAKAO_LOCAL_ADDRESS_URL}?query=${encodeURIComponent(query)}&size=1`, {
        headers: { Authorization: `KakaoAK ${restKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { documents?: { x: string; y: string }[] };
      const d = body.documents?.[0];
      if (!d) return null;
      const lat = Number(d.y);
      const lng = Number(d.x);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    } catch {
      return null;
    }
  };
  return {
    kind: 'kakao',
    geocode: (q) => search(q.roadAddress.replace(/\s*\(예시\)\s*$/, '')),
    dongCenter: (_code, label) => search(label),
  };
}

export function createGeoAdapter(env: NodeJS.ProcessEnv = process.env): GeoAdapter {
  if (resolveGeoDriver(env.GEO_DRIVER) === 'kakao') {
    if (!env.KAKAO_REST_API_KEY) throw new Error('GEO_DRIVER=kakao 이면 KAKAO_REST_API_KEY 환경변수가 필요합니다.');
    return createKakaoGeoAdapter(env.KAKAO_REST_API_KEY);
  }
  return createMockGeoAdapter();
}
