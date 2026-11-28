/**
 * 테스트용 가상 데이터 정의 (seed-demo.ts 가 사용).
 * - 사람 이름은 누구나 아는 예시 이름(홍길동·김철수…)이나 "역할+성" 형태로, 실존 인물처럼 보이지 않게 한다.
 * - 휴대폰 번호는 010-0000-XXXX(국번 0000은 실제로 발급되지 않음), 주소는 "(예시)"를 붙인 가상 도로명이다.
 * - 법정동 코드·좌표는 행정구역 공개 정보(개인정보 아님)이며 Mock 주소·지오코딩과 같은 값을 쓴다.
 * - 코드값은 모두 common_code(ERD §4)에 있는 값만 쓴다. 새 테이블·컬럼·코드를 만들지 않는다.
 */

export const DEMO_TAG = '[가상 데이터]';

/* ---------- 거점·관할 지역 ---------- */

export interface DemoBranch {
  code: string;
  name: string;
  status: 'ACTIVE' | 'PREPARING';
  address: string;
  lat: string;
  lng: string;
  radiusKm: string;
  phone: string;
  openedAt: string | null;
}

export const DEMO_BRANCHES: DemoBranch[] = [
  { code: 'EP01', name: '은평거점', status: 'ACTIVE', address: '서울 은평구 통일로 100 (예시)', lat: '37.6177000', lng: '126.9288000', radiusKm: '5.0', phone: '02-0000-0001', openedAt: '2026-03-02' },
  { code: 'BD01', name: '분당거점', status: 'ACTIVE', address: '경기 성남시 분당구 판교역로 100 (예시)', lat: '37.3925000', lng: '127.1112000', radiusKm: '6.0', phone: '031-0000-0002', openedAt: '2026-06-01' },
  { code: 'BS01', name: '해운대거점', status: 'PREPARING', address: '부산 해운대구 해운대로 100 (예시)', lat: '35.1631000', lng: '129.1636000', radiusKm: '5.0', phone: '051-0000-0003', openedAt: null },
];

export interface DemoArea {
  branch: string;
  sido: string;
  sigungu: string;
  dong: string;
  code: string;
  serviceable: boolean;
  travelFee: number;
  lat: number;
  lng: number;
  zipcode: string;
  road: string;
}

/**
 * 은평 5개 동 + 분당 2개 동은 서비스 가능(가상 고객 주소·기사 담당 동), 해운대 우동은 오픈 준비(서비스 불가 → 오픈 알림 신청 시험).
 * 코드는 실제 법정동 코드(카카오 우편번호 bcode)와 같다. 나머지 은평구·분당구 동은 DEMO_EXTRA_AREAS 로 서비스 가능 처리한다.
 */
export const DEMO_AREAS: DemoArea[] = [
  { branch: 'EP01', sido: '서울특별시', sigungu: '은평구', dong: '갈현동', code: '1138010400', serviceable: true, travelFee: 0, lat: 37.6177, lng: 126.9288, zipcode: '03300', road: '서울 은평구 갈현로' },
  { branch: 'EP01', sido: '서울특별시', sigungu: '은평구', dong: '구산동', code: '1138010500', serviceable: true, travelFee: 0, lat: 37.6142, lng: 126.9201, zipcode: '03390', road: '서울 은평구 연서로' },
  { branch: 'EP01', sido: '서울특별시', sigungu: '은평구', dong: '불광동', code: '1138010300', serviceable: true, travelFee: 0, lat: 37.6106, lng: 126.9161, zipcode: '03431', road: '서울 은평구 불광로' },
  { branch: 'EP01', sido: '서울특별시', sigungu: '은평구', dong: '대조동', code: '1138010600', serviceable: true, travelFee: 0, lat: 37.6251, lng: 126.9223, zipcode: '03319', road: '서울 은평구 대조로' },
  { branch: 'EP01', sido: '서울특별시', sigungu: '은평구', dong: '녹번동', code: '1138010200', serviceable: true, travelFee: 10000, lat: 37.6029, lng: 126.9124, zipcode: '03470', road: '서울 은평구 통일로' },
  { branch: 'BD01', sido: '경기도', sigungu: '성남시 분당구', dong: '백현동', code: '4113511000', serviceable: true, travelFee: 0, lat: 37.3925, lng: 127.1112, zipcode: '13529', road: '경기 성남시 분당구 백현로' },
  { branch: 'BD01', sido: '경기도', sigungu: '성남시 분당구', dong: '삼평동', code: '4113510900', serviceable: true, travelFee: 0, lat: 37.4005, lng: 127.1086, zipcode: '13487', road: '경기 성남시 분당구 삼평로' },
  { branch: 'BS01', sido: '부산광역시', sigungu: '해운대구', dong: '우동', code: '2635010500', serviceable: false, travelFee: 0, lat: 35.1631, lng: 129.1636, zipcode: '48094', road: '부산 해운대구 해운대로' },
];

/** 실제 주소로 견적을 시험할 수 있도록 은평구·분당구의 나머지 법정동도 서비스 가능으로 등록 */
export const DEMO_EXTRA_AREAS: { branch: string; sido: string; sigungu: string; dong: string; code: string }[] = [
  ...(
    [
      ['1138010100', '수색동'],
      ['1138010700', '응암동'],
      ['1138010800', '역촌동'],
      ['1138010900', '신사동'],
      ['1138011000', '증산동'],
      ['1138011400', '진관동'],
    ] as const
  ).map(([code, dong]) => ({ branch: 'EP01', sido: '서울특별시', sigungu: '은평구', dong, code })),
  ...(
    [
      ['4113510100', '분당동'],
      ['4113510200', '수내동'],
      ['4113510300', '정자동'],
      ['4113510400', '율동'],
      ['4113510500', '서현동'],
      ['4113510600', '이매동'],
      ['4113510700', '야탑동'],
      ['4113510800', '판교동'],
      ['4113511100', '금곡동'],
      ['4113511200', '궁내동'],
      ['4113511300', '동원동'],
      ['4113511400', '구미동'],
      ['4113511500', '운중동'],
      ['4113511600', '대장동'],
      ['4113511700', '석운동'],
      ['4113511800', '하산운동'],
    ] as const
  ).map(([code, dong]) => ({ branch: 'BD01', sido: '경기도', sigungu: '성남시 분당구', dong, code })),
];

/* ---------- 관리자 계정 ---------- */

export interface DemoAdmin {
  loginId: string;
  name: string;
  role: 'ADM_CS' | 'ADM_OPS' | 'ADM_BRANCH' | 'ADM_FIN' | 'ADM_MKT' | 'ADM_SUPER';
  branch: string | null;
  status: 'ACTIVE' | 'LOCKED';
  phone: string;
  desc: string;
}

export const DEMO_ADMINS: DemoAdmin[] = [
  { loginId: 'demo-super', name: '오관리', role: 'ADM_SUPER', branch: null, status: 'ACTIVE', phone: '01000009001', desc: '슈퍼관리자 (모든 메뉴·시스템 설정)' },
  { loginId: 'demo-ops', name: '김운영', role: 'ADM_OPS', branch: null, status: 'ACTIVE', phone: '01000009002', desc: '운영자 (배정·처리 콘솔·주문)' },
  { loginId: 'demo-cs', name: '이상담', role: 'ADM_CS', branch: null, status: 'ACTIVE', phone: '01000009003', desc: '상담원 (상담 콘솔·고객·VOC)' },
  { loginId: 'demo-ep', name: '박거점', role: 'ADM_BRANCH', branch: 'EP01', status: 'ACTIVE', phone: '01000009004', desc: '은평거점 거점장 (은평 데이터만 보임)' },
  { loginId: 'demo-bd', name: '최분당', role: 'ADM_BRANCH', branch: 'BD01', status: 'ACTIVE', phone: '01000009005', desc: '분당거점 거점장 (분당 데이터만 보임)' },
  { loginId: 'demo-fin', name: '정재무', role: 'ADM_FIN', branch: null, status: 'ACTIVE', phone: '01000009006', desc: '정산/재무 (결제·환불·정산)' },
  { loginId: 'demo-mkt', name: '한마케팅', role: 'ADM_MKT', branch: null, status: 'ACTIVE', phone: '01000009007', desc: '마케터 (캠페인·쿠폰·통계)' },
  { loginId: 'demo-locked', name: '윤잠김', role: 'ADM_CS', branch: null, status: 'LOCKED', phone: '01000009008', desc: '잠긴 계정 (잠금 해제 시험용, 로그인 불가)' },
];

export const demoAdminEmail = (loginId: string) => `${loginId}@example.com`;

/* ---------- 기사 ---------- */

export type TechKey = 'kang' | 'seo' | 'moon' | 'shin' | 'noh' | 'ryu' | 'jang' | 'lim';

export interface DemoTech {
  key: TechKey;
  code: string;
  name: string;
  phone: string;
  branch: string;
  grade: 'TRAINEE' | 'REGULAR' | 'LEADER';
  contract: 'EMPLOYEE' | 'FREELANCER' | 'PARTNER';
  status: 'TRAINING' | 'ACTIVE' | 'PAUSED' | 'LEFT';
  joinedDaysAgo: number;
  /** 관할 법정동 (주 관할) */
  dongs: string[];
  intro: string | null;
  desc: string;
}

export const DEMO_TECHS: DemoTech[] = [
  { key: 'kang', code: 'EPT01', name: '강팀장', phone: '01000001001', branch: 'EP01', grade: 'LEADER', contract: 'EMPLOYEE', status: 'ACTIVE', joinedDaysAgo: 260, dongs: ['1138010400', '1138010500'], intro: '꼼꼼한 완전분해 세척 전문입니다.', desc: '은평 팀장 · 오늘 작업 4건(완료·작업중·대기) · 코스 진행중' },
  { key: 'seo', code: 'EPT02', name: '서기사', phone: '01000001002', branch: 'EP01', grade: 'REGULAR', contract: 'FREELANCER', status: 'ACTIVE', joinedDaysAgo: 200, dongs: ['1138010300', '1138010600'], intro: '시간 약속을 지키는 기사입니다.', desc: '은평 정규 · 결제 대기·미처리·이동중 작업 · 자가 배정 요청 · 정산 이의' },
  { key: 'moon', code: 'EPT03', name: '문기사', phone: '01000001003', branch: 'EP01', grade: 'REGULAR', contract: 'PARTNER', status: 'ACTIVE', joinedDaysAgo: 150, dongs: ['1138010200'], intro: null, desc: '은평 정규(파트너) · 이관 요청 중인 작업 · 코스 확정' },
  { key: 'shin', code: 'EPT04', name: '신견습', phone: '01000001004', branch: 'EP01', grade: 'TRAINEE', contract: 'EMPLOYEE', status: 'TRAINING', joinedDaysAgo: 20, dongs: [], intro: null, desc: '교육 중 견습 · 기본과정 수강 중(동행 1/3)' },
  { key: 'noh', code: 'EPT05', name: '노휴직', phone: '01000001005', branch: 'EP01', grade: 'REGULAR', contract: 'FREELANCER', status: 'PAUSED', joinedDaysAgo: 300, dongs: [], intro: null, desc: '휴직 중 (로그인 불가 시험용)' },
  { key: 'ryu', code: 'EPT06', name: '류퇴사', phone: '01000001006', branch: 'EP01', grade: 'REGULAR', contract: 'FREELANCER', status: 'LEFT', joinedDaysAgo: 330, dongs: [], intro: null, desc: '이탈 처리된 기사 (로그인 불가, 이탈 분석용)' },
  { key: 'jang', code: 'BDT01', name: '장분당', phone: '01000002001', branch: 'BD01', grade: 'LEADER', contract: 'EMPLOYEE', status: 'ACTIVE', joinedDaysAgo: 170, dongs: ['4113511000', '4113510900'], intro: '천장형·시스템 에어컨 전문입니다.', desc: '분당 팀장 · 분당 고객 작업' },
  { key: 'lim', code: 'BDT02', name: '임분당', phone: '01000002002', branch: 'BD01', grade: 'REGULAR', contract: 'FREELANCER', status: 'ACTIVE', joinedDaysAgo: 120, dongs: ['4113510900'], intro: null, desc: '분당 정규 · 2인 작업 지원' },
];

/* ---------- 고객 ---------- */

export type CustKey = 'hong' | 'kim' | 'lee' | 'park' | 'jung' | 'han' | 'oh' | 'seo' | 'song' | 'yim' | 'jo' | 'bae';

export interface DemoCustomer {
  key: CustKey;
  name: string;
  phone: string;
  type: 'PERSONAL' | 'BUSINESS';
  join: 'APP' | 'PHONE' | 'REFERRAL';
  /** 앱 로그인 수단. null = 전화로만 접수한 고객(앱 로그인 시 기존 고객 연결 F-CUS-AUTH-04) */
  auth: 'PHONE' | null;
  grade: 'NORMAL' | 'VIP' | 'FREQUENT' | 'CAUTION';
  status: 'ACTIVE' | 'DORMANT' | 'WITHDRAWN';
  marketing: boolean;
  email: string | null;
  tags: ('FREQUENT' | 'CAUTION' | 'MOVING')[];
  joinedDaysAgo: number;
  memo: string | null;
  /** 주소: 관할 법정동 코드 + 번지·건물 */
  addresses: { dong: string; no: number; alias: string; detail: string; housing: 'APT' | 'VILLA' | 'OFFICETEL' | 'HOUSE' | 'OFFICE' | 'STORE'; elevator: boolean; parking?: string }[];
  desc: string;
}

export const DEMO_CUSTOMERS: DemoCustomer[] = [
  { key: 'hong', name: '홍길동', phone: '01000000001', type: 'PERSONAL', join: 'APP', auth: 'PHONE', grade: 'VIP', status: 'ACTIVE', marketing: true, email: 'hong@example.com', tags: ['FREQUENT'], joinedDaysAgo: 240, memo: '재방문 고객, 오전 방문 선호', addresses: [ { dong: '1138010400', no: 12, alias: '우리집', detail: '101동 1001호', housing: 'APT', elevator: true, parking: '지하 주차장 방문 등록' }, { dong: '1138010500', no: 45, alias: '부모님댁', detail: '2층', housing: 'VILLA', elevator: false } ], desc: 'VIP · 완료 이력 다수 · 오늘 완료 1건 · 다가오는 예약 · 보유 기기 · 쿠폰 사용 · 후기' },
  { key: 'kim', name: '김철수', phone: '01000000002', type: 'PERSONAL', join: 'APP', auth: 'PHONE', grade: 'NORMAL', status: 'ACTIVE', marketing: true, email: null, tags: [], joinedDaysAgo: 90, memo: null, addresses: [ { dong: '1138010400', no: 88, alias: '집', detail: '305동 702호', housing: 'APT', elevator: true } ], desc: '오늘 작업중(추가요금 동의 대기) · 미배정 예약 · 쿠폰 보유' },
  { key: 'lee', name: '이영희', phone: '01000000003', type: 'PERSONAL', join: 'PHONE', auth: null, grade: 'NORMAL', status: 'ACTIVE', marketing: false, email: null, tags: [], joinedDaysAgo: 60, memo: '전화 접수 고객 (앱 미가입)', addresses: [ { dong: '1138010500', no: 7, alias: '집', detail: '3층 301호', housing: 'VILLA', elevator: false } ], desc: '전화 접수만 한 고객 · 상담 이력 · 오늘 방문 예정 · 앱 첫 로그인 시 이력 연결' },
  { key: 'park', name: '박영수', phone: '01000000004', type: 'BUSINESS', join: 'PHONE', auth: 'PHONE', grade: 'FREQUENT', status: 'ACTIVE', marketing: false, email: 'office@example.com', tags: ['FREQUENT'], joinedDaysAgo: 120, memo: '사업자 고객(가상 상호: 테스트상사), 세금계산서 발행', addresses: [ { dong: '1138010300', no: 150, alias: '사무실', detail: '테스트빌딩 4층', housing: 'OFFICE', elevator: true, parking: '건물 뒤편 주차' } ], desc: '사업자 · 천장형 다수 · 세금계산서 · 다가오는 예약' },
  { key: 'jung', name: '정다운', phone: '01000000005', type: 'PERSONAL', join: 'APP', auth: 'PHONE', grade: 'NORMAL', status: 'ACTIVE', marketing: true, email: null, tags: [], joinedDaysAgo: 45, memo: null, addresses: [ { dong: '1138010600', no: 33, alias: '집', detail: '1203호', housing: 'OFFICETEL', elevator: true } ], desc: '오늘 방문 예정 · 긴급 미지정 접수 · 저평점 후기(VOC)' },
  { key: 'han', name: '한가람', phone: '01000000006', type: 'PERSONAL', join: 'APP', auth: 'PHONE', grade: 'NORMAL', status: 'ACTIVE', marketing: false, email: null, tags: [], joinedDaysAgo: 75, memo: null, addresses: [ { dong: '1138010300', no: 21, alias: '집', detail: '102동 504호', housing: 'APT', elevator: true } ], desc: '작업 완료 · 결제 대기(작업 후 결제) · 일정 변경 요청' },
  { key: 'oh', name: '오나래', phone: '01000000007', type: 'PERSONAL', join: 'REFERRAL', auth: 'PHONE', grade: 'CAUTION', status: 'ACTIVE', marketing: false, email: null, tags: ['CAUTION'], joinedDaysAgo: 30, memo: '부재 잦음, 방문 전 통화 필수', addresses: [ { dong: '1138010200', no: 9, alias: '집', detail: '단독주택', housing: 'HOUSE', elevator: false, parking: '골목 주차 불가' } ], desc: '주의 고객 · 고객부재 미처리 · 취소 요청 · 안전사고' },
  { key: 'seo', name: '서보람', phone: '01000000008', type: 'PERSONAL', join: 'APP', auth: 'PHONE', grade: 'NORMAL', status: 'ACTIVE', marketing: true, email: null, tags: ['MOVING'], joinedDaysAgo: 50, memo: '다음 달 이사 예정', addresses: [ { dong: '1138010600', no: 70, alias: '집', detail: '201동 1502호', housing: 'APT', elevator: true } ], desc: '오늘 기사 이동중 · 자가 배정 요청 대상 예약 · AS 요청' },
  { key: 'song', name: '송하늘', phone: '01000000009', type: 'PERSONAL', join: 'APP', auth: 'PHONE', grade: 'NORMAL', status: 'ACTIVE', marketing: true, email: null, tags: [], joinedDaysAgo: 40, memo: null, addresses: [ { dong: '1138010200', no: 55, alias: '집', detail: '104동 302호', housing: 'APT', elevator: true } ], desc: '이관 요청 중인 오늘 작업 · 선결제 예약 · 1:1 문의' },
  { key: 'yim', name: '임바다', phone: '01000000010', type: 'PERSONAL', join: 'APP', auth: 'PHONE', grade: 'NORMAL', status: 'ACTIVE', marketing: true, email: null, tags: [], joinedDaysAgo: 100, memo: null, addresses: [ { dong: '4113511000', no: 18, alias: '집', detail: '501동 1101호', housing: 'APT', elevator: true } ], desc: '분당 고객 · 완료 이력 · 다가오는 예약' },
  { key: 'jo', name: '조새봄', phone: '01000000011', type: 'PERSONAL', join: 'APP', auth: 'PHONE', grade: 'NORMAL', status: 'ACTIVE', marketing: false, email: null, tags: [], joinedDaysAgo: 80, memo: null, addresses: [ { dong: '4113510900', no: 3, alias: '집', detail: '7층 703호', housing: 'OFFICETEL', elevator: true } ], desc: '분당 고객 · 시스템 에어컨 2인 작업 완료' },
  { key: 'bae', name: '배이슬', phone: '01000000012', type: 'PERSONAL', join: 'APP', auth: 'PHONE', grade: 'NORMAL', status: 'DORMANT', marketing: false, email: null, tags: [], joinedDaysAgo: 420, memo: '1년 이상 미이용 → 휴면', addresses: [ { dong: '1138010400', no: 99, alias: '집', detail: '5층', housing: 'VILLA', elevator: false } ], desc: '휴면 고객 (로그인하면 휴면 해제)' },
];

/* ---------- 상품·가격·할증·옵션·자재·쿠폰 ---------- */

export const DEMO_CATEGORIES = [
  { code: 'AIRCON_CLEAN', name: '에어컨 청소', phase: 1, isActive: true, sortOrder: 1 },
  { code: 'WASHER_CLEAN', name: '세탁기 청소', phase: 2, isActive: false, sortOrder: 2 },
];

export interface DemoProduct {
  code: string;
  name: string;
  deviceType: string;
  cleanLevel: 'BASIC' | 'FULL' | 'OUTDOOR';
  minutes: number;
  techCount?: number;
  skill?: 'REGULAR' | 'LEADER';
  included: string | null;
  excluded: string | null;
  warrantyDays: number;
  price: number;
  /** 대수 할인 */
  tiers?: { min: number; rate: number }[];
}

export const DEMO_PRODUCTS: DemoProduct[] = [
  { code: 'AC-WALL-BASIC', name: '벽걸이 일반 세척', deviceType: 'WALL', cleanLevel: 'BASIC', minutes: 60, included: '필터·외관·송풍구', excluded: '열교환기 분해', warrantyDays: 14, price: 70000 },
  { code: 'AC-WALL-FULL', name: '벽걸이 완전분해 세척', deviceType: 'WALL', cleanLevel: 'FULL', minutes: 90, included: '필터·열교환기·송풍팬·드레인판', excluded: '실외기', warrantyDays: 30, price: 90000, tiers: [ { min: 2, rate: 5 }, { min: 3, rate: 10 } ] },
  { code: 'AC-WALL-OUT', name: '실외기 세척', deviceType: 'WALL', cleanLevel: 'OUTDOOR', minutes: 40, included: '실외기 핀·팬 고압 세척', excluded: null, warrantyDays: 14, price: 40000 },
  { code: 'AC-STAND-BASIC', name: '스탠드 일반 세척', deviceType: 'STAND', cleanLevel: 'BASIC', minutes: 80, included: '필터·외관·토출구', excluded: '열교환기 분해', warrantyDays: 14, price: 100000 },
  { code: 'AC-STAND-FULL', name: '스탠드 완전분해 세척', deviceType: 'STAND', cleanLevel: 'FULL', minutes: 120, included: '필터·열교환기·송풍팬·드레인판', excluded: '실외기', warrantyDays: 30, price: 130000, tiers: [ { min: 2, rate: 5 } ] },
  { code: 'AC-2IN1-FULL', name: '2in1(스탠드+벽걸이) 완전분해 세척', deviceType: 'TWO_IN_ONE', cleanLevel: 'FULL', minutes: 180, included: '스탠드 1대 + 벽걸이 1대 완전분해', excluded: '실외기', warrantyDays: 30, price: 200000 },
  { code: 'AC-CEIL1-FULL', name: '천장형 1way 완전분해 세척', deviceType: 'CEILING_1WAY', cleanLevel: 'FULL', minutes: 120, skill: 'REGULAR', included: '패널·필터·열교환기·드레인펌프', excluded: null, warrantyDays: 30, price: 120000 },
  { code: 'AC-CEIL4-FULL', name: '천장형 4way 완전분해 세척', deviceType: 'CEILING_4WAY', cleanLevel: 'FULL', minutes: 150, skill: 'REGULAR', included: '패널·필터·열교환기·드레인펌프', excluded: null, warrantyDays: 30, price: 150000, tiers: [ { min: 3, rate: 10 } ] },
  { code: 'AC-SYS-FULL', name: '시스템 에어컨 완전분해 세척', deviceType: 'SYSTEM', cleanLevel: 'FULL', minutes: 150, techCount: 2, skill: 'LEADER', included: '실내기 완전분해(2인 작업)', excluded: null, warrantyDays: 30, price: 160000 },
  { code: 'AC-WIN-BASIC', name: '창문형 일반 세척', deviceType: 'WINDOW', cleanLevel: 'BASIC', minutes: 50, included: '필터·외관·열교환기 스팀', excluded: null, warrantyDays: 14, price: 60000 },
];

/** 은평거점 전용 단가(공통가보다 우선, BR-010) · 사업자 전용 단가 */
export const DEMO_BRANCH_PRICES = [{ product: 'AC-WALL-FULL', branch: 'EP01', price: 85000 }];
export const DEMO_BUSINESS_PRICES = [{ product: 'AC-CEIL4-FULL', price: 140000 }];

export const DEMO_SURCHARGES = [
  { ruleCode: 'NIGHT', name: '야간 방문 할증', applyType: 'AUTO_QUOTE', conditionJson: { weekday: true, after: '18:00' }, amountType: 'FIXED', amount: 30000, perUnit: false, customerNotice: '평일 18시 이후 방문은 할증이 붙어요.' },
  { ruleCode: 'HOLIDAY', name: '휴일 방문 할증', applyType: 'AUTO_QUOTE', conditionJson: { weekend: true, holiday: true }, amountType: 'FIXED', amount: 30000, perUnit: false, customerNotice: '주말·공휴일 방문은 할증이 붙어요.' },
  { ruleCode: 'OUTER_AREA', name: '권역 외 출장비', applyType: 'AUTO_QUOTE', conditionJson: null, amountType: 'FIXED', amount: 0, perUnit: false, customerNotice: '거점에서 먼 지역은 출장비가 붙어요.' },
  { ruleCode: 'HIGH_PLACE', name: '고소 작업', applyType: 'ON_SITE', conditionJson: null, amountType: 'FIXED', amount: 20000, perUnit: true, customerNotice: '2.5m 이상 높은 곳은 대당 추가' },
  { ruleCode: 'HEAVY_DIRT', name: '오염 심함', applyType: 'ON_SITE', conditionJson: null, amountType: 'FIXED', amount: 20000, perUnit: true, customerNotice: '곰팡이·오염이 심하면 대당 추가' },
  { ruleCode: 'NO_PARKING', name: '주차 불가', applyType: 'ON_SITE', conditionJson: null, amountType: 'FIXED', amount: 10000, perUnit: false, customerNotice: '주차가 어려우면 유료 주차비 추가' },
  { ruleCode: 'URGENT', name: '긴급 출동', applyType: 'ON_SITE', conditionJson: null, amountType: 'FIXED', amount: 30000, perUnit: false, customerNotice: '당일 긴급 방문은 추가' },
] as const;

export const DEMO_OPTIONS = [
  { code: 'OPT-ANTIBAC', name: '항균 코팅', product: null, price: 15000, minutes: 10 },
  { code: 'OPT-DEODOR', name: '탈취 스팀 케어', product: null, price: 10000, minutes: 10 },
  { code: 'OPT-DRAIN', name: '배수 호스 교체', product: 'AC-WALL-FULL', price: 20000, minutes: 15 },
];

export const DEMO_MATERIALS = [
  { code: 'M-CLEANER', name: '에어컨 전용 세정제', unit: 'L', cost: 8000, sale: 0, safety: 10 },
  { code: 'M-ANTIBAC', name: '항균 코팅제', unit: 'L', cost: 12000, sale: 0, safety: 5 },
  { code: 'M-FILTER', name: '교체용 미세먼지 필터', unit: 'EA', cost: 5000, sale: 12000, safety: 20 },
  { code: 'M-DRAIN', name: '배수 호스(1m)', unit: 'EA', cost: 3000, sale: 8000, safety: 15 },
  { code: 'M-COVER', name: '방수 세척 커버', unit: 'EA', cost: 1500, sale: 0, safety: 30 },
  { code: 'M-BOX', name: '정전기 청소포', unit: 'BOX', cost: 6000, sale: 0, safety: 5 },
];

export const DEMO_COUPONS = [
  { code: 'WELCOME5000', name: '첫 예약 5,000원 할인', type: 'FIXED', value: 5000, max: null, min: 50000, from: '2026-01-01', to: '2027-06-30', limit: 1000 },
  { code: 'WINTER10', name: '겨울 비수기 10% 할인', type: 'RATE', value: 10, max: 20000, min: 80000, from: '2026-11-01', to: '2027-02-28', limit: 500 },
  { code: 'REVISIT7000', name: '재방문 감사 7,000원', type: 'FIXED', value: 7000, max: null, min: 60000, from: '2026-01-01', to: '2027-12-31', limit: null },
  { code: 'SUMMER2026', name: '여름 사전예약 할인(종료)', type: 'RATE', value: 15, max: 30000, min: 0, from: '2026-04-01', to: '2026-06-30', limit: 300 },
] as const;
