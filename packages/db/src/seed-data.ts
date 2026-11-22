/**
 * 기준 시드 데이터. common_code는 01_ERD §4가 단일 출처이며, 이 파일은 그 표를 옮긴 것이다.
 * 코드를 추가·변경하면 ERD §4를 먼저 고친다.
 */
import { ADMIN_ROLE_CODES, type AdminRoleCode, type DataScope } from '@aircon/domain';

type CodeRow = [code: string, name: string];
const g = (groupCode: string, rows: CodeRow[]) =>
  rows.map(([code, name], i) => ({ groupCode, code, name, sortOrder: (i + 1) * 10 }));

export const COMMON_CODE_SEED = [
  ...g('DEVICE_TYPE', [
    ['WALL', '벽걸이'],
    ['STAND', '스탠드'],
    ['CEILING_1WAY', '천장형1way'],
    ['CEILING_4WAY', '천장형4way'],
    ['TWO_IN_ONE', '2in1'],
    ['WINDOW', '창문형'],
    ['SYSTEM', '시스템'],
  ]),
  ...g('BRAND', [
    ['SAMSUNG', '삼성'],
    ['LG', 'LG'],
    ['CARRIER', '캐리어'],
    ['WINIA', '위니아'],
    ['CHUNGHO', '청호'],
    ['ETC', '기타'],
  ]),
  ...g('HOUSING_TYPE', [
    ['APT', '아파트'],
    ['VILLA', '빌라'],
    ['OFFICETEL', '오피스텔'],
    ['HOUSE', '단독주택'],
    ['OFFICE', '사무실'],
    ['STORE', '매장'],
    ['SCHOOL', '학교'],
  ]),
  ...g('ORDER_CHANNEL', [
    ['APP', '앱'],
    ['PHONE', '전화'],
    ['B2B', 'B2B'],
    ['CAMPAIGN', '캠페인'],
    ['AS', 'AS'],
    ['ADMIN', '관리자'],
  ]),
  ...g('ORDER_STATUS', [
    ['QUOTED', '견적완료'],
    ['RECEIVED', '접수'],
    ['ASSIGN_WAIT', '배정대기(미지정)'],
    ['ASSIGNED', '배정완료'],
    ['ON_THE_WAY', '이동중'],
    ['IN_PROGRESS', '작업중'],
    ['PENDING', '미처리(보류)'],
    ['WORK_DONE', '작업완료'],
    ['COMPLETED', '완료'],
    ['CANCELED', '취소'],
  ]),
  ...g('PENDING_REASON', [
    ['CUSTOMER_ABSENT', '고객부재'],
    ['POSTPONED_CUSTOMER', '출장연기(고객)'],
    ['POSTPONED_TECH', '출장연기(기사)'],
    ['MATERIAL_SHORT', '자재미지참'],
    ['UNSAFE_SITE', '작업불가현장'],
    ['WEATHER', '기상'],
    ['ETC', '기타'],
  ]),
  ...g('CANCEL_REASON', [
    ['CUSTOMER_REQUEST', '고객 요청'],
    ['NO_TECH', '기사 없음'],
    ['DUPLICATE', '중복 접수'],
    ['OUT_OF_AREA', '서비스 지역 아님'],
    ['NO_SHOW', '고객 연락두절'],
    ['PRICE', '가격 불만'],
  ]),
  ...g('RESULT_CODE', [
    ['DONE_NORMAL', '정상완료'],
    ['DONE_PARTIAL', '일부완료'],
    ['NEED_REPAIR', '수리필요안내'],
    ['NOT_CLEANABLE', '세척불가'],
  ]),
  ...g('CONSULT_TYPE', [
    ['INQUIRY', '일반문의'],
    ['ORDER', '출장접수'],
    ['FOLLOWUP', '독촉·전달'],
    ['CLAIM', '클레임'],
    ['SAFETY', '안전사고'],
    ['CHANGE', '변경·취소'],
  ]),
  ...g('DAMAGE_TYPE', [
    ['DEVICE_BREAK', '기기 파손'],
    ['WATER_LEAK', '누수'],
    ['PROPERTY', '재물 파손'],
    ['INJURY', '인적 사고'],
    ['FIRE_ELECTRIC', '화재·전기'],
  ]),
  ...g('MEDIA_FLAG', [
    ['PRESS', '언론'],
    ['INTERNET', '인터넷'],
    ['POLICE', '경찰'],
    ['FIRE', '소방'],
    ['INSURANCE', '보험사'],
    ['ETC', '대외단체'],
  ]),
  ...g('MEMO_HEADER', [
    ['RECEIVABLE', '[미수금]'],
    ['REVISIT', '[재방문]'],
    ['CUSTOMER_CONTACT', '[고객연락]'],
    ['MANUAL', '수기'],
  ]),
  ...g('TECH_GRADE', [
    ['TRAINEE', '견습'],
    ['REGULAR', '정식'],
    ['LEADER', '팀장'],
  ]),
  ...g('ZONE_TYPE', [
    ['PRIMARY', '주 관할'],
    ['SECONDARY', '보조 관할'],
  ]),
  ...g('ROUTE_STATUS', [
    ['DRAFT', '작성중'],
    ['OPTIMIZED', '자동추천'],
    ['CONFIRMED', '확정'],
    ['IN_PROGRESS', '진행중'],
    ['DONE', '완료'],
  ]),
  ...g('STOP_TYPE', [
    ['JOB', '작업'],
    ['BREAK', '휴식'],
    ['MATERIAL', '자재수령'],
    ['BRANCH', '거점복귀'],
  ]),
  ...g('SCHEDULE_TYPE', [
    ['WORK', '근무'],
    ['OFF', '휴무'],
    ['HALF_AM', '오전 반차'],
    ['HALF_PM', '오후 반차'],
    ['ANNUAL', '연차'],
    ['ON_CALL', '대기'],
    ['TRAINING', '교육'],
  ]),
  ...g('PAYMENT_METHOD', [
    ['CARD', '카드'],
    ['EASY_PAY', '간편결제'],
    ['BANK_TRANSFER', '계좌이체'],
    ['VIRTUAL_ACCOUNT', '가상계좌'],
    ['CASH', '현금'],
    ['ONSITE_CARD', '현장카드'],
  ]),
  // ── 단계 0에서 추가한 그룹 (ERD §4 하단 표) ──
  ...g('BRANCH_STATUS', [
    ['PREPARING', '준비중'],
    ['ACTIVE', '운영중'],
    ['PAUSED', '일시중지'],
    ['CLOSED', '폐점'],
  ]),
  ...g('ADMIN_STATUS', [
    ['ACTIVE', '사용'],
    ['LOCKED', '잠김'],
    ['RETIRED', '퇴사'],
  ]),
  ...g('DATA_SCOPE', [
    ['ALL', '전체'],
    ['BRANCH', '소속 거점'],
    ['SELF', '본인'],
  ]),
  ...g('PERMISSION_ACTION', [
    ['READ', '조회'],
    ['CREATE', '등록'],
    ['UPDATE', '수정'],
    ['DELETE', '삭제'],
    ['EXPORT', '다운로드'],
    ['APPROVE', '승인'],
  ]),
  ...g('SERVICE_PHASE', [
    ['1', 'MVP'],
    ['2', '가전확장'],
    ['3', '잡일'],
  ]),
  ...g('CLEAN_LEVEL', [
    ['BASIC', '일반'],
    ['FULL', '완전분해'],
    ['OUTDOOR', '실외기'],
  ]),
  ...g('CUSTOMER_TYPE', [
    ['PERSONAL', '개인'],
    ['BUSINESS', '법인'],
  ]),
  ...g('SURCHARGE_RULE', [
    ['NIGHT', '야간 방문 할증'],
    ['HOLIDAY', '휴일 방문 할증'],
    ['HIGH_PLACE', '고소작업'],
    ['HEAVY_DIRT', '오염 심함'],
    ['OUTER_AREA', '권역 외'],
    ['URGENT', '당일긴급'],
    ['NO_PARKING', '주차 불가'],
  ]),
  ...g('SURCHARGE_APPLY_TYPE', [
    ['AUTO_QUOTE', '견적 자동'],
    ['ON_SITE', '현장 추가(고객 동의)'],
  ]),
  ...g('AMOUNT_TYPE', [
    ['FIXED', '정액'],
    ['RATE', '정률(%)'],
  ]),
  ...g('MATERIAL_UNIT', [
    ['EA', '개'],
    ['L', '리터'],
    ['BOX', '박스'],
  ]),
  ...g('ATTACHMENT_REF_TYPE', [
    ['WORK_PHOTO', '작업 사진'],
    ['EXTRA_CHARGE', '추가요금 증빙'],
    ['SAFETY', '안전관리'],
    ['DEVICE', '기기'],
    ['REVIEW', '후기'],
    ['NOTICE', '공지'],
    ['DOC', '문서'],
  ]),
  ...g('AUDIT_ACTION', [
    ['VIEW_PII', '개인정보 열람'],
    ['EXPORT', '다운로드'],
    ['UPDATE', '수정'],
    ['DELETE', '삭제'],
    ['LOGIN', '로그인'],
    ['PERMISSION_CHANGE', '권한 변경'],
  ]),
];

/** ERD §0.2 역할. 거점장만 BRANCH 범위이고, 나머지는 소속 거점이 지정되면 BR-102에 따라 그 거점으로 제한된다. */
export const ROLE_SEED: { roleCode: AdminRoleCode; name: string; dataScope: DataScope }[] = [
  { roleCode: 'ADM_CS', name: '상담원', dataScope: 'ALL' },
  { roleCode: 'ADM_OPS', name: '운영자(배정)', dataScope: 'ALL' },
  { roleCode: 'ADM_BRANCH', name: '거점장', dataScope: 'BRANCH' },
  { roleCode: 'ADM_FIN', name: '정산/재무', dataScope: 'ALL' },
  { roleCode: 'ADM_MKT', name: '마케터', dataScope: 'ALL' },
  { roleCode: 'ADM_SUPER', name: '슈퍼관리자', dataScope: 'ALL' },
];
if (ROLE_SEED.length !== ADMIN_ROLE_CODES.length) throw new Error('ROLE_SEED와 ADMIN_ROLE_CODES가 다릅니다.');

/**
 * 양력 고정 공휴일(2027). 설·추석 등 음력 공휴일과 대체공휴일은 매년 정부 발표 후 A-SYS-050에서 등록한다.
 */
export const HOLIDAY_SEED = [
  { holidayDate: '2027-01-01', name: '신정' },
  { holidayDate: '2027-03-01', name: '삼일절' },
  { holidayDate: '2027-05-05', name: '어린이날' },
  { holidayDate: '2027-06-06', name: '현충일' },
  { holidayDate: '2027-08-15', name: '광복절' },
  { holidayDate: '2027-10-03', name: '개천절' },
  { holidayDate: '2027-10-09', name: '한글날' },
  { holidayDate: '2027-12-25', name: '성탄절' },
];
