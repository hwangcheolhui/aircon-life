import { describe, expect, it } from 'vitest';
import { createMockAddressSearch, fromKakaoPostcode, resolveAddressDriver } from './index';

describe('주소 검색 어댑터 (F-CUS-QUO-01)', () => {
  it('F-CUS-QUO-01 카카오 우편번호 결과의 bcode를 법정동 코드로 쓴다', () => {
    const r = fromKakaoPostcode({
      zonecode: '03300',
      roadAddress: '서울 은평구 불광로 1',
      jibunAddress: '',
      autoJibunAddress: '서울 은평구 불광동 1',
      bcode: '1138010400',
      sido: '서울',
      sigungu: '은평구',
      bname: '불광동',
      buildingName: '',
    });
    expect(r).toMatchObject({
      legalDongCode: '1138010400',
      jibunAddress: '서울 은평구 불광동 1',
      eupmyeondong: '불광동',
      buildingName: null,
    });
  });
  it('F-CUS-QUO-01 Mock 검색은 공백을 무시하고 동 이름으로 찾는다', async () => {
    const s = createMockAddressSearch();
    expect((await s.search('불광 동')).map((a) => a.legalDongCode)).toEqual(['1138010400']);
    expect(await s.search('  ')).toEqual([]);
  });
  it('드라이버 기본값은 kakao, mock 지정 시 mock', () => {
    expect(resolveAddressDriver(undefined)).toBe('kakao');
    expect(resolveAddressDriver('mock')).toBe('mock');
  });
});
