/**
 * 알림 템플릿 (01 §2.12.1 notification_template). 본문의 치환 변수 `#{고객명}` 등을 값으로 바꾼다.
 * 단계 2 템플릿 코드: ORDER_CONFIRMED(접수), ORDER_CHANGED(일정 변경), ORDER_CANCELED(취소), VISIT_REMINDER(방문 전날, F-SYS-03)
 */
export const NOTIFICATION_TEMPLATE_CODES = [
  'ORDER_CONFIRMED',
  'ORDER_CHANGED',
  'ORDER_CANCELED',
  'VISIT_REMINDER',
  'TECH_ASSIGNED',
  'ON_THE_WAY',
  'WORK_DONE',
  'PAYMENT_DONE',
  'REVISIT_11M',
  'REVIEW_REQUEST',
  // 단계 4-1: 기사 앱 알림(T-NTF-010) · 운영자 미지정 경고(F-SYS-09)
  'TECH_JOB_ASSIGNED',
  'TECH_JOB_CHANGED',
  'TECH_TRANSFER_REJECTED',
  'UNASSIGNED_WARNING',
  // 단계 4-2: 코스 확정 고객 안내(F-TEC-RTE-03) · 코스 배치(F-SYS-15·16) · 자가 배정(F-TEC-RTE-04, F-ADM-DSP-10)
  'VISIT_TIME_NOTICE',
  'VISIT_TIME_CHANGED',
  'ROUTE_DRAFT_READY',
  'ROUTE_CONFIRM_REMIND',
  'ROUTE_AUTO_CONFIRMED',
  'SELF_ASSIGN_REQUESTED',
  'SELF_ASSIGN_APPROVED',
  'SELF_ASSIGN_REJECTED',
  // 단계 5-1: 출발·완료 고객 알림(F-SYS-04)은 위 ON_THE_WAY·WORK_DONE
  // 단계 5-2: 추가요금 동의 요청(F-CUS-ORD-04)·고객부재 안내(F-TEC-WRK-08)·기사 결과 알림·운영자 승인 요청(F-ADM-PRC-04)·장기 미처리(F-SYS-08)
  'EXTRA_CHARGE_REQUEST',
  'PENDING_ABSENT',
  'EXTRA_CHARGE_RESULT',
  'EXTRA_APPROVAL_REQUESTED',
  'PENDING_OVERDUE',
] as const;
export type NotificationTemplateCode = (typeof NOTIFICATION_TEMPLATE_CODES)[number];

export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/#\{([^}]+)\}/g, (_, k: string) => vars[k.trim()] ?? '');
}

/** 화면 템플릿 편집(A-CRM-040)에서 안내하는 치환 변수 */
export const TEMPLATE_VARIABLES = [
  '고객명',
  '접수번호',
  '방문일시',
  '금액',
  '거점전화',
  '기사명',
  '방문예정',
  '코스일자',
  '방문건수',
  '도착예정',
  '리포트링크',
  '추가요금',
  '동의링크',
  '결과',
] as const;
