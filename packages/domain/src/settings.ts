/**
 * system_setting 키 목록과 초기값 (ERD §2.13.8). 기준값은 코드가 아니라 이 테이블에서 읽는다.
 * 여기의 값은 "최초 시드값"일 뿐이며, 운영 중 값은 A-SYS-050에서 바꾼다.
 */
export interface SystemSettingSeed {
  key: string;
  value: string;
  description: string;
}

export const SYSTEM_SETTING_SEEDS: readonly SystemSettingSeed[] = [
  { key: 'QUOTE_EXPIRE_DAYS', value: '7', description: '견적 유효기간(일) BR-015' },
  { key: 'QUOTE_SITE_SURVEY_MIN_UNITS', value: '4', description: '시스템·천장형 합계가 이 대수 이상이면 현장 확인 견적 안내 F-CUS-QUO-04' },
  { key: 'REVISIT_MONTHS', value: '11', description: '재방문 알림 기준 개월 BR-091' },
  { key: 'PURGE_YEARS', value: '5', description: '개인정보 보관 연수(법무 확인 필요) ERD §6' },
  { key: 'SETTLEMENT_WEEKDAY', value: 'WED', description: '정산 지급 요일 BR-080' },
  { key: 'POPUP_DEFAULT_TIME', value: '08:30', description: '기사 앱 메모 팝업 기본 시각' },
  { key: 'DUPLICATE_CHECK_DAYS', value: '30', description: '이중접수 확인 기간(일) BR-020' },
  { key: 'ROUTE_CONFIRM_DEADLINE', value: '18:00', description: '다음 날 코스 확정 마감(전날 시각) BR-113' },
  { key: 'ROUTE_TRAVEL_BUFFER_MIN', value: '10', description: '지점 간 이동 버퍼(분) BR-114' },
  { key: 'ARRIVAL_WINDOW_HOURS', value: '2', description: '도착 허용 시간창(시간) BR-112' },
  { key: 'LOCATION_INTERVAL_SEC', value: '60', description: '근무 중 위치 수집 간격(초) BR-115' },
  { key: 'LOCATION_RETENTION_DAYS', value: '90', description: '기사 위치 원본 보관(일) ERD §6' },
  { key: 'SELF_ASSIGN_ENABLED', value: 'Y', description: '자가 배정 사용 여부(거점별 Y/N) §3.7' },
  { key: 'SELF_ASSIGN_NEEDS_APPROVAL', value: 'Y', description: '자가 배정 운영자 승인 필요 §3.7' },
  { key: 'ADMIN_LOGIN_MAX_FAIL', value: '5', description: '관리자 로그인 실패 잠금 횟수 02 §7' },
  { key: 'ADMIN_PASSWORD_MIN_LENGTH', value: '8', description: '관리자 비밀번호 최소 길이 A-AUTH-020' },
  // ── 단계 2 예약 ──
  { key: 'SLOT_DAYS_AHEAD', value: '14', description: '슬롯 자동 생성·고객 예약 가능 일수(내일부터) F-SYS-01·F-CUS-RSV-01' },
  { key: 'SLOT_JOBS_PER_TECH_HOUR', value: '1', description: '기사 1명이 1시간에 받는 건수(슬롯 수용 건수 계산) F-ADM-DSP-05' },
  { key: 'WORK_DEFAULT_START', value: '09:00', description: '근무 시간을 비운 근무표의 기본 시작 시각 F-ADM-DSP-06' },
  { key: 'WORK_DEFAULT_END', value: '18:00', description: '근무 시간을 비운 근무표의 기본 종료 시각 F-ADM-DSP-06' },
  { key: 'CANCEL_FEE_HOURS', value: '24', description: '방문 몇 시간 이내 취소부터 취소 수수료 BR-030' },
  { key: 'CANCEL_FEE_AMOUNT', value: '0', description: '취소 수수료(원, 0=없음) BR-030' },
  { key: 'TERMS_VERSION', value: 'v1.0', description: '고객 약관 버전(consent_history.terms_version) F-CUS-AUTH-03' },
];

export const SETTING_KEYS = {
  QUOTE_EXPIRE_DAYS: 'QUOTE_EXPIRE_DAYS',
  QUOTE_SITE_SURVEY_MIN_UNITS: 'QUOTE_SITE_SURVEY_MIN_UNITS',
  ADMIN_LOGIN_MAX_FAIL: 'ADMIN_LOGIN_MAX_FAIL',
  ADMIN_PASSWORD_MIN_LENGTH: 'ADMIN_PASSWORD_MIN_LENGTH',
  PURGE_YEARS: 'PURGE_YEARS',
  DUPLICATE_CHECK_DAYS: 'DUPLICATE_CHECK_DAYS',
  SLOT_DAYS_AHEAD: 'SLOT_DAYS_AHEAD',
  SLOT_JOBS_PER_TECH_HOUR: 'SLOT_JOBS_PER_TECH_HOUR',
  WORK_DEFAULT_START: 'WORK_DEFAULT_START',
  WORK_DEFAULT_END: 'WORK_DEFAULT_END',
  CANCEL_FEE_HOURS: 'CANCEL_FEE_HOURS',
  CANCEL_FEE_AMOUNT: 'CANCEL_FEE_AMOUNT',
  TERMS_VERSION: 'TERMS_VERSION',
} as const;
