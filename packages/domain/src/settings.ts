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
  // ── 단계 2 예약 ──
  { key: 'SLOT_DAYS_AHEAD', value: '14', description: '슬롯 자동 생성·고객 예약 가능 일수(내일부터) F-SYS-01·F-CUS-RSV-01' },
  { key: 'SLOT_JOBS_PER_TECH_HOUR', value: '1', description: '기사 1명이 1시간에 받는 건수(슬롯 수용 건수 계산) F-ADM-DSP-05' },
  { key: 'WORK_DEFAULT_START', value: '09:00', description: '근무 시간을 비운 근무표의 기본 시작 시각 F-ADM-DSP-06' },
  { key: 'WORK_DEFAULT_END', value: '18:00', description: '근무 시간을 비운 근무표의 기본 종료 시각 F-ADM-DSP-06' },
  { key: 'CANCEL_FEE_HOURS', value: '24', description: '방문 몇 시간 이내 취소부터 취소 수수료 BR-030' },
  { key: 'CANCEL_FEE_AMOUNT', value: '0', description: '취소 수수료(원, 0=없음) BR-030' },
  { key: 'TERMS_VERSION', value: 'v1.0', description: '고객 약관 버전(consent_history.terms_version) F-CUS-AUTH-03' },
  // ── 단계 3 상담 콘솔 ──
  { key: 'PRIVACY_REASK_MONTHS', value: '12', description: '개인정보 미동의 고객에게 상담 콘솔에서 동의를 다시 묻는 주기(개월) BR-023' },
  // ── 단계 4-1 배정·기사 앱 ──
  { key: 'ASSIGN_TRAVEL_BUFFER_MIN', value: '30', description: '배정 보드 시간 겹침 검사에 더하는 이동 버퍼(분) F-ADM-DSP-01' },
  { key: 'TECH_ACCOMPANY_COUNT', value: '3', description: '신규 견습 기사 초기 팀장 동행 건수(기사 등록 시 기본값) BR-071' },
  { key: 'UNASSIGNED_ALERT_HOURS', value: '4', description: '미지정(긴급) 건을 약속 몇 시간 전부터 경고할지 F-SYS-09·BR-024' },
  { key: 'TECH_LOGIN_MAX_FAIL', value: '5', description: '기사 앱 비밀번호 로그인 실패 잠금 횟수(인증번호 로그인으로 해제) F-TEC-AUTH-01' },
  { key: 'TECH_PASSWORD_MIN_LENGTH', value: '8', description: '기사 앱 비밀번호 최소 길이 F-TEC-MY-01' },
  // ── 단계 4-2 관할 구역·코스 ──
  { key: 'SELF_ASSIGN_DAYS_AHEAD', value: '7', description: '기사 관할 지도에 보이는 미배정 작업의 약속 범위(오늘부터 N일) F-TEC-RTE-04' },
  { key: 'ROUTE_BREAK_DEFAULT_MIN', value: '60', description: '코스에 휴식·식사 지점을 넣을 때 기본 시간(분) F-TEC-RTE-01' },
  { key: 'ZONE_DONG_RADIUS_M', value: '600', description: '법정동 경계 데이터가 없을 때 동 중심 둘레로 그리는 근사 경계 반경(m) F-ADM-DSP-08' },
  // ── 단계 5-1 현장작업 ──
  { key: 'WORK_NOTE_MIN_LENGTH', value: '10', description: '처리 저장(완료) 때 처리 내용 최소 글자 수(공백 제외) F-TEC-WRK-07' },
  { key: 'WORK_PHOTO_CAMERA_ONLY', value: 'N', description: '작업 사진을 카메라 촬영으로만 받을지(Y면 갤러리 선택 제한) F-TEC-WRK-03' },
  // ── 단계 5-2 추가요금·미처리 ──
  { key: 'PENDING_OVERDUE_HOURS', value: '48', description: '미처리(PENDING) 후 이 시간이 지나면 장기 미처리(색상 강조·운영자 알림) BR-032 F-SYS-08' },
  // ── 단계 8 사후관리·운영 마감 ──
  { key: 'CAMPAIGN_CONVERSION_DAYS', value: '60', description: '캠페인 발송 후 며칠 안에 접수하면 예약 전환으로 볼지(일) F-ADM-CRM-01' },
  { key: 'PURGE_APPROVAL_MODE', value: 'Y', description: 'Y면 파기 배치가 바로 지우지 않고 A-CUS-030에서 슈퍼관리자가 일괄 승인해야 파기 F-SYS-12' },
  { key: 'MARKETING_COST_MONTHLY', value: '0', description: '월 마케팅비(원, 수기 입력·0이면 미입력) — KPI 고객 획득비(CAC) 계산 ERD §5' },
  { key: 'KPI_TARGET_MONTHLY_JOBS', value: '150', description: 'KPI 목표: 월 처리 건수(성수기) ERD §5' },
  { key: 'KPI_TARGET_MARGIN_RATE', value: '30', description: 'KPI 목표: 마진율(%) ERD §5' },
  { key: 'KPI_TARGET_REVISIT_RATE', value: '30', description: 'KPI 목표: 재방문율(%) ERD §5' },
  { key: 'KPI_TARGET_RETENTION_RATE', value: '60', description: 'KPI 목표: 기사 6개월 정착률(%) ERD §5' },
  { key: 'KPI_TARGET_OFFPEAK_RATIO', value: '40', description: 'KPI 목표: 비수기/성수기 매출 비(%) ERD §5' },
  { key: 'KPI_TARGET_AS_RATE', value: '5', description: 'KPI 목표: AS·불만율(% 이하) ERD §5' },
  { key: 'KPI_TARGET_CAC_RATE', value: '15', description: 'KPI 목표: 고객 획득비 ÷ 객단가(% 이하) ERD §5' },
];

export const SETTING_KEYS = {
  QUOTE_EXPIRE_DAYS: 'QUOTE_EXPIRE_DAYS',
  QUOTE_SITE_SURVEY_MIN_UNITS: 'QUOTE_SITE_SURVEY_MIN_UNITS',
  AREA_OPEN_REQUEST_KEEP_DAYS: 'AREA_OPEN_REQUEST_KEEP_DAYS',
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
  PRIVACY_REASK_MONTHS: 'PRIVACY_REASK_MONTHS',
  ASSIGN_TRAVEL_BUFFER_MIN: 'ASSIGN_TRAVEL_BUFFER_MIN',
  TECH_ACCOMPANY_COUNT: 'TECH_ACCOMPANY_COUNT',
  UNASSIGNED_ALERT_HOURS: 'UNASSIGNED_ALERT_HOURS',
  TECH_LOGIN_MAX_FAIL: 'TECH_LOGIN_MAX_FAIL',
  TECH_PASSWORD_MIN_LENGTH: 'TECH_PASSWORD_MIN_LENGTH',
  ROUTE_CONFIRM_DEADLINE: 'ROUTE_CONFIRM_DEADLINE',
  ROUTE_TRAVEL_BUFFER_MIN: 'ROUTE_TRAVEL_BUFFER_MIN',
  ARRIVAL_WINDOW_HOURS: 'ARRIVAL_WINDOW_HOURS',
  LOCATION_INTERVAL_SEC: 'LOCATION_INTERVAL_SEC',
  LOCATION_RETENTION_DAYS: 'LOCATION_RETENTION_DAYS',
  SELF_ASSIGN_ENABLED: 'SELF_ASSIGN_ENABLED',
  SELF_ASSIGN_NEEDS_APPROVAL: 'SELF_ASSIGN_NEEDS_APPROVAL',
  SELF_ASSIGN_DAYS_AHEAD: 'SELF_ASSIGN_DAYS_AHEAD',
  ROUTE_BREAK_DEFAULT_MIN: 'ROUTE_BREAK_DEFAULT_MIN',
  ZONE_DONG_RADIUS_M: 'ZONE_DONG_RADIUS_M',
  REVISIT_MONTHS: 'REVISIT_MONTHS',
  CAMPAIGN_CONVERSION_DAYS: 'CAMPAIGN_CONVERSION_DAYS',
  PURGE_APPROVAL_MODE: 'PURGE_APPROVAL_MODE',
  MARKETING_COST_MONTHLY: 'MARKETING_COST_MONTHLY',
  KPI_TARGET_MONTHLY_JOBS: 'KPI_TARGET_MONTHLY_JOBS',
  KPI_TARGET_MARGIN_RATE: 'KPI_TARGET_MARGIN_RATE',
  KPI_TARGET_REVISIT_RATE: 'KPI_TARGET_REVISIT_RATE',
  KPI_TARGET_RETENTION_RATE: 'KPI_TARGET_RETENTION_RATE',
  KPI_TARGET_OFFPEAK_RATIO: 'KPI_TARGET_OFFPEAK_RATIO',
  KPI_TARGET_AS_RATE: 'KPI_TARGET_AS_RATE',
  KPI_TARGET_CAC_RATE: 'KPI_TARGET_CAC_RATE',
  WORK_NOTE_MIN_LENGTH: 'WORK_NOTE_MIN_LENGTH',
  WORK_PHOTO_CAMERA_ONLY: 'WORK_PHOTO_CAMERA_ONLY',
  PENDING_OVERDUE_HOURS: 'PENDING_OVERDUE_HOURS',
  SETTLEMENT_WEEKDAY: 'SETTLEMENT_WEEKDAY',
} as const;
