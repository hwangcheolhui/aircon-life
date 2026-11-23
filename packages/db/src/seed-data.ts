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
  // ── 단계 1에서 추가한 그룹 (ERD §4 하단 표) ──
  ...g('QUOTE_STATUS', [
    ['DRAFT', '작성중'],
    ['ISSUED', '발행'],
    ['CONVERTED', '주문전환'],
    ['EXPIRED', '만료'],
  ]),
  ...g('QUOTE_ITEM_TYPE', [
    ['PRODUCT', '상품'],
    ['OPTION', '옵션'],
    ['SURCHARGE', '할증'],
    ['DISCOUNT', '할인'],
  ]),
  // ── 단계 2에서 추가한 그룹 (ERD §4 하단 표) ──
  ...g('CUSTOMER_STATUS', [
    ['ACTIVE', '정상'],
    ['DORMANT', '휴면'],
    ['WITHDRAWN', '탈퇴'],
    ['PURGED', '파기'],
  ]),
  ...g('CUSTOMER_GRADE', [
    ['NORMAL', '일반'],
    ['VIP', 'VIP'],
    ['FREQUENT', '다빈도'],
    ['CAUTION', '주의'],
  ]),
  ...g('JOIN_CHANNEL', [
    ['APP', '앱'],
    ['PHONE', '전화'],
    ['B2B', 'B2B'],
    ['REFERRAL', '추천'],
    ['MIGRATION', '이관'],
  ]),
  ...g('AUTH_PROVIDER', [
    ['KAKAO', '카카오'],
    ['NAVER', '네이버'],
    ['APPLE', '애플'],
    ['PHONE', '휴대폰'],
  ]),
  ...g('PRIVACY_AGREE_STATUS', [
    ['AGREED', '동의'],
    ['DISAGREED', '미동의'],
    ['NOT_ASKED', '질의못함'],
  ]),
  ...g('CONSENT_TYPE', [
    ['TERMS', '서비스 이용약관'],
    ['PRIVACY_REQUIRED', '개인정보 수집·이용(필수)'],
    ['PRIVACY_OPTIONAL', '개인정보 수집·이용(선택)'],
    ['LOCATION', '위치정보 이용'],
    ['MARKETING_SMS', '혜택·이벤트 문자·알림톡 받기'],
    ['MARKETING_PUSH', '혜택·이벤트 앱 알림 받기'],
    ['THIRD_PARTY', '개인정보 제3자 제공'],
  ]),
  ...g('CONSENT_ACTION', [
    ['AGREE', '동의'],
    ['DISAGREE', '미동의'],
    ['NOT_ASKED', '질의못함'],
    ['WITHDRAW', '철회'],
  ]),
  ...g('CONSENT_CHANNEL', [
    ['APP', '앱'],
    ['PHONE', '전화(구두)'],
    ['WEB', '웹'],
    ['PAPER', '서면'],
  ]),
  ...g('ORDER_TYPE', [
    ['NORMAL', '일반'],
    ['URGENT', '긴급'],
    ['AS', '무상AS'],
    ['B2B_CONTRACT', '정기계약'],
  ]),
  ...g('VISIT_TYPE', [
    ['IN_HOURS', '업무시간내'],
    ['NIGHT', '야간'],
    ['HOLIDAY', '휴일'],
  ]),
  ...g('PAYMENT_STATUS', [
    ['UNPAID', '미결제'],
    ['PREPAID', '선결제'],
    ['PAID', '결제완료'],
    ['PARTIAL_REFUND', '부분환불'],
    ['REFUNDED', '환불'],
    ['RECEIVABLE', '미수'],
  ]),
  ...g('PAYMENT_STAGE', [
    ['PREPAY', '예약 시 선결제'],
    ['ONSITE', '현장 결제'],
    ['POSTPAY', '작업 후 앱 결제'],
    ['INVOICE', 'B2B 청구'],
  ]),
  ...g('PAYMENT_TX_STATUS', [
    ['READY', '대기'],
    ['APPROVED', '승인'],
    ['FAILED', '실패'],
    ['CANCELED', '취소'],
    ['PARTIAL_CANCELED', '부분취소'],
  ]),
  ...g('PG_PROVIDER', [
    ['TOSS', '토스페이먼츠'],
    ['NICE', '나이스페이'],
    ['KCP', 'KCP'],
    ['MOCK', '모의 결제(개발용)'],
  ]),
  ...g('REFUND_REASON', [
    ['CUSTOMER_CANCEL', '고객 취소'],
    ['SERVICE_FAIL', '서비스 불가'],
    ['COMPENSATION', '보상'],
    ['DUPLICATE', '중복 결제'],
  ]),
  ...g('REFUND_STATUS', [
    ['REQUESTED', '요청'],
    ['DONE', '완료'],
    ['FAILED', '실패'],
  ]),
  ...g('CHANGE_REQUEST_TYPE', [
    ['RESCHEDULE', '일정 변경'],
    ['CANCEL', '취소'],
  ]),
  ...g('CHANGE_REQUEST_STATUS', [
    ['REQUESTED', '요청'],
    ['APPROVED', '승인'],
    ['REJECTED', '반려'],
  ]),
  ...g('SLOT_KIND', [
    ['NORMAL', '일반'],
    ['CONTRACT', '계약'],
    ['URGENT', '긴급'],
    ['ON_CALL', '당직'],
  ]),
  ...g('ITEM_STATUS', [
    ['PLANNED', '예정'],
    ['DONE', '완료'],
    ['SKIPPED', '작업불가'],
  ]),
  ...g('ACTOR_TYPE', [
    ['CUSTOMER', '고객'],
    ['TECHNICIAN', '기사'],
    ['ADMIN', '관리자'],
    ['SYSTEM', '시스템'],
  ]),
  ...g('NOTIFICATION_CHANNEL', [
    ['ALIMTALK', '알림톡'],
    ['SMS', '문자'],
    ['PUSH', '앱 푸시'],
    ['EMAIL', '이메일'],
  ]),
  ...g('NOTIFICATION_TARGET', [
    ['CUSTOMER', '고객'],
    ['TECHNICIAN', '기사'],
    ['ADMIN', '관리자'],
  ]),
  ...g('NOTIFICATION_STATUS', [
    ['QUEUED', '대기'],
    ['SENT', '발송'],
    ['FAILED', '실패'],
    ['FALLBACK_SMS', '문자 대체 발송'],
  ]),
  ...g('TECH_STATUS', [
    ['APPLICANT', '지원'],
    ['TRAINING', '교육중'],
    ['ACTIVE', '활동'],
    ['PAUSED', '휴직'],
    ['LEFT', '이탈'],
  ]),
  ...g('CONTRACT_TYPE', [
    ['EMPLOYEE', '근로'],
    ['FREELANCER', '도급(사업소득 3.3%)'],
    ['PARTNER', '사업자'],
  ]),
];

/**
 * 알림 템플릿 초기값 (01 §2.12.1). 운영 중 문구는 A-CRM-040에서 바꾸며 시드는 덮어쓰지 않는다.
 * 알림톡은 카카오 검수 후 받은 템플릿 ID를 kakao_template_id 에 넣어야 실제로 발송되고, 비어 있으면 문자(SMS)로 보낸다.
 */
export const NOTIFICATION_TEMPLATE_SEED = [
  {
    templateCode: 'ORDER_CONFIRMED',
    channel: 'ALIMTALK',
    target: 'CUSTOMER',
    title: '예약 접수 안내',
    body: '#{고객명}님, 에어컨 청소 예약이 접수되었습니다.\n접수번호: #{접수번호}\n방문 일시: #{방문일시}\n금액: #{금액}\n기사님이 배정되면 다시 알려 드릴게요.',
  },
  {
    templateCode: 'ORDER_CHANGED',
    channel: 'ALIMTALK',
    target: 'CUSTOMER',
    title: '예약 일정 변경 안내',
    body: '#{고객명}님, 예약 일정이 변경되었습니다.\n접수번호: #{접수번호}\n변경된 방문 일시: #{방문일시}',
  },
  {
    templateCode: 'ORDER_CANCELED',
    channel: 'ALIMTALK',
    target: 'CUSTOMER',
    title: '예약 취소 안내',
    body: '#{고객명}님, 예약이 취소되었습니다.\n접수번호: #{접수번호}\n결제하신 금액은 취소 규정에 따라 환불됩니다.',
  },
  {
    templateCode: 'VISIT_REMINDER',
    channel: 'ALIMTALK',
    target: 'CUSTOMER',
    title: '내일 방문 안내',
    body: '#{고객명}님, 내일 #{방문일시}에 에어컨 청소 기사님이 방문합니다.\n접수번호: #{접수번호}\n에어컨 주변 물건을 치워 주시고, 주차가 어려우면 미리 알려 주세요. 문의: #{거점전화}',
  },
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
