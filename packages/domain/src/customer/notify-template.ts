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
  // 단계 6: 작업 후 결제 요청(앱 알림톡·결제 링크 문자, F-TEC-PAY-01)·결제 완료(PAYMENT_DONE)
  'PAYMENT_REQUEST',
  'PAYMENT_LINK',
  // 단계 7: 정산 확인 요청·지급 완료(기사 푸시, F-ADM-STL-02·04)·이의 제기(운영자 푸시, F-TEC-STL-02)
  'STL_CONFIRM_REQUEST',
  'STL_DISPUTED',
  'STL_PAID',
  // 단계 8: 독촉·전달(F-ADM-CSL-11·F-TEC-NTF-02)·안전사고 통보(BR-060·061)·AS(F-CUS-AS-01·F-ADM-VOC-03)·1:1 문의 답변·재방문(REVISIT_11M, F-SYS-06)
  'FOLLOWUP_SENT',
  'FOLLOWUP_ADMIN',
  'FOLLOWUP_REPLIED',
  'SAFETY_INCIDENT',
  'SAFETY_ESCALATED',
  'AS_RECEIVED',
  'AS_SCHEDULED',
  'AS_REJECTED',
  'INQUIRY_ANSWERED',
  // 단계 9: 후기 요청(REVIEW_REQUEST, F-SYS-05)·쿠폰 발급(F-ADM-CRM-03)·시즌·타겟 캠페인(F-ADM-CRM-02)·검수 반려(F-ADM-PRC-03)
  //        ·진행 중 지연(F-TEC-RTE-06)·코스 변경 요청(F-ADM-DSP-09)·휴면 안내(F-SYS-13)·PG 대사 불일치(F-SYS-14)
  'COUPON_ISSUED',
  'CAMPAIGN_MESSAGE',
  'INSPECTION_REJECTED',
  'ETA_DELAY_TECH',
  'VISIT_DELAY',
  'ROUTE_CHANGE_REQUESTED',
  'ROUTE_CHANGE_APPROVED',
  'ROUTE_CHANGE_REJECTED',
  'DORMANT_NOTICE',
  'PG_MISMATCH',
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
  '결제금액',
  '결제링크',
  '정산회차',
  '실지급액',
  '독촉회차',
  '전달내용',
  '회신',
  '사고번호',
  '피해유형',
  'AS번호',
  '보증안내',
  '사유',
  '경과개월',
  '예약링크',
] as const;
