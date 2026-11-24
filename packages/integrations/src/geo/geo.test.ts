import { describe, expect, it } from 'vitest';
import { createGeoAdapter, createKakaoGeoAdapter, createMockGeoAdapter, mockDongCenter, resolveGeoDriver } from './index';

describe('지오코딩 (Mock)', () => {
  it('같은 주소는 항상 같은 좌표이고 법정동 중심 근처다', async () => {
    const g = createMockGeoAdapter();
    const a = await g.geocode({ roadAddress: '서울 은평구 불광로 1 (예시)', legalDongCode: '1138010400' });
    const b = await g.geocode({ roadAddress: '서울 은평구 불광로 1 (예시)', legalDongCode: '1138010400' });
    expect(a).toEqual(b);
    const c = mockDongCenter('1138010400');
    expect(Math.abs(a!.lat - c.lat)).toBeLessThan(0.004);
    expect(Math.abs(a!.lng - c.lng)).toBeLessThan(0.005);
  });

  it('주소가 다르면 좌표가 다르다', async () => {
    const g = createMockGeoAdapter();
    const a = await g.geocode({ roadAddress: '가 1', legalDongCode: '1138010400' });
    const b = await g.geocode({ roadAddress: '가 2', legalDongCode: '1138010400' });
    expect(a).not.toEqual(b);
  });

  it('모르는 법정동도 서울시청 주변의 고정 좌표를 준다', () => {
    const p = mockDongCenter('9999999999');
    expect(p).toEqual(mockDongCenter('9999999999'));
    expect(Math.abs(p.lat - 37.5665)).toBeLessThan(0.09);
  });

  it('기본 드라이버는 mock, kakao 는 REST 키가 필요하다', () => {
    expect(resolveGeoDriver(undefined)).toBe('mock');
    expect(createGeoAdapter({} as NodeJS.ProcessEnv).kind).toBe('mock');
    expect(() => createGeoAdapter({ GEO_DRIVER: 'kakao' } as NodeJS.ProcessEnv)).toThrow('KAKAO_REST_API_KEY');
  });
});

describe('지오코딩 (카카오 로컬)', () => {
  it('응답의 x·y 를 경도·위도로 읽는다', async () => {
    const fake = (async () => new Response(JSON.stringify({ documents: [{ x: '126.9288', y: '37.6177' }] }))) as unknown as typeof fetch;
    const g = createKakaoGeoAdapter('test-key', fake);
    expect(await g.geocode({ roadAddress: '서울 은평구 불광로 1', legalDongCode: null })).toEqual({ lat: 37.6177, lng: 126.9288 });
  });

  it('실패하면 null', async () => {
    const fake = (async () => new Response('err', { status: 500 })) as unknown as typeof fetch;
    expect(await createKakaoGeoAdapter('k', fake).dongCenter('1', '서울')).toBeNull();
  });
});
