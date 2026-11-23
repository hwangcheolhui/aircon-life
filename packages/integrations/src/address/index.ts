/**
 * 주소 검색 (F-CUS-QUO-01 위치 입력, 이후 F-ADM-CSL-02 주소 정제에서도 사용). CLAUDE.md §7 인터페이스 + Mock + Real.
 * - Real: 카카오(다음) 우편번호 서비스(무료, 키 불필요, 06 §4.1). 위젯이 결과에 법정동 코드(bcode)를 준다 → BR-001 매핑.
 *   위젯은 브라우저 UI라 스크립트 삽입은 화면 쪽(apps/web)에서 하고, 여기서는 결과를 공통 형식으로 바꾼다.
 * - Mock: 고정된 예시 주소 목록에서 검색 (개발·E2E, 외부 네트워크 없이 동작).
 * 전환: NEXT_PUBLIC_ADDRESS_DRIVER=kakao|mock (기본 kakao)
 * 이 모듈은 브라우저·서버 공용이다(Node 전용 API 없음).
 */

/** 주소 검색 결과 공통 형식 (customer_address 4단계 정제 결과의 앞부분, 01 §2.2.2) */
export interface AddressResult {
  zipcode: string;
  roadAddress: string;
  jibunAddress: string | null;
  /** 법정동 코드 10자리 → service_area.legal_dong_code (BR-001) */
  legalDongCode: string;
  sido: string;
  sigungu: string;
  eupmyeondong: string;
  buildingName: string | null;
}

export type AddressDriver = 'kakao' | 'mock';

export function resolveAddressDriver(value: string | undefined): AddressDriver {
  return value === 'mock' ? 'mock' : 'kakao';
}

/** 공통 인터페이스: 검색어 → 주소 후보 (Mock). Real(카카오)은 위젯이 검색 UI를 직접 그리므로 onComplete 결과를 변환한다. */
export interface AddressSearchAdapter {
  search(query: string): Promise<AddressResult[]>;
}

/* ---------- Real: 카카오 우편번호 서비스 ---------- */

export const KAKAO_POSTCODE_SCRIPT = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

/** 카카오 우편번호 서비스 oncomplete 데이터 중 쓰는 필드 */
export interface KakaoPostcodeData {
  zonecode: string;
  roadAddress: string;
  jibunAddress: string;
  autoJibunAddress?: string;
  bcode: string;
  sido: string;
  sigungu: string;
  bname: string;
  buildingName?: string;
}

export function fromKakaoPostcode(d: KakaoPostcodeData): AddressResult {
  return {
    zipcode: d.zonecode,
    roadAddress: d.roadAddress,
    jibunAddress: d.jibunAddress || d.autoJibunAddress || null,
    legalDongCode: d.bcode,
    sido: d.sido,
    sigungu: d.sigungu,
    eupmyeondong: d.bname,
    buildingName: d.buildingName || null,
  };
}

/* ---------- Mock ---------- */

/** 예시 주소(실존 개인 주소 아님). E2E는 이 법정동 코드로 관할 지역을 등록한다. */
export const MOCK_ADDRESSES: readonly AddressResult[] = [
  {
    zipcode: '03300',
    roadAddress: '서울 은평구 불광로 1 (예시)',
    jibunAddress: '서울 은평구 불광동 1',
    legalDongCode: '1138010400',
    sido: '서울',
    sigungu: '은평구',
    eupmyeondong: '불광동',
    buildingName: null,
  },
  {
    zipcode: '03390',
    roadAddress: '서울 은평구 대조로 1 (예시)',
    jibunAddress: '서울 은평구 대조동 1',
    legalDongCode: '1138010500',
    sido: '서울',
    sigungu: '은평구',
    eupmyeondong: '대조동',
    buildingName: null,
  },
  {
    zipcode: '13529',
    roadAddress: '경기 성남시 분당구 판교역로 166',
    jibunAddress: '경기 성남시 분당구 백현동 532',
    legalDongCode: '4113511000',
    sido: '경기',
    sigungu: '성남시 분당구',
    eupmyeondong: '백현동',
    buildingName: null,
  },
  {
    zipcode: '21354',
    roadAddress: '인천 부평구 부평대로 1 (예시)',
    jibunAddress: '인천 부평구 부평동 1',
    legalDongCode: '2823710100',
    sido: '인천',
    sigungu: '부평구',
    eupmyeondong: '부평동',
    buildingName: null,
  },
  {
    zipcode: '48094',
    roadAddress: '부산 해운대구 해운대로 1 (예시)',
    jibunAddress: '부산 해운대구 우동 1',
    legalDongCode: '2635010500',
    sido: '부산',
    sigungu: '해운대구',
    eupmyeondong: '우동',
    buildingName: null,
  },
];

export function createMockAddressSearch(
  list: readonly AddressResult[] = MOCK_ADDRESSES,
): AddressSearchAdapter {
  return {
    async search(query) {
      const q = query.replace(/\s+/g, '');
      if (!q) return [];
      return list.filter((a) =>
        `${a.roadAddress}${a.jibunAddress ?? ''}${a.eupmyeondong}`.replace(/\s+/g, '').includes(q),
      );
    },
  };
}
