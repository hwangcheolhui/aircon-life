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
  { key: 'AREA_OPEN_REQUEST_KEEP_DAYS', value: '365', description: '오픈 알림 신청 대기 보관일(지나면 만료·연락처 삭제) BR-003' },
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
];

export const SETTING_KEYS = {
  QUOTE_EXPIRE_DAYS: 'QUOTE_EXPIRE_DAYS',
  QUOTE_SITE_SURVEY_MIN_UNITS: 'QUOTE_SITE_SURVEY_MIN_UNITS',
  AREA_OPEN_REQUEST_KEEP_DAYS: 'AREA_OPEN_REQUEST_KEEP_DAYS',
  ADMIN_LOGIN_MAX_FAIL: 'ADMIN_LOGIN_MAX_FAIL',
  ADMIN_PASSWORD_MIN_LENGTH: 'ADMIN_PASSWORD_MIN_LENGTH',
} as const;
