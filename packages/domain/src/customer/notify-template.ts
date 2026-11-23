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
] as const;
export type NotificationTemplateCode = (typeof NOTIFICATION_TEMPLATE_CODES)[number];

export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/#\{([^}]+)\}/g, (_, k: string) => vars[k.trim()] ?? '');
}

/** 화면 템플릿 편집(A-CRM-040)에서 안내하는 치환 변수 */
export const TEMPLATE_VARIABLES = ['고객명', '접수번호', '방문일시', '금액', '거점전화', '기사명'] as const;
