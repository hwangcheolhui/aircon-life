/**
 * 사후관리 (단계 8-1): D6 독촉·전달·안전사고·VOC (01_ERD §2.6.3~2.6.6, VOC 처리 이력 §2.6.8) + D12 AS 요청(§2.12.8).
 * AS 는 VOC 와 서로 참조해 순환 import 를 피하려고 같은 파일에 둔다.
 * - 상태 변경은 packages/domain aftercare-rules 전이표(01 §3.12~3.15)를 거친다.
 * - voc_history 는 INSERT ONLY(DB 트리거). 🔒 incident_recipient.phone 은 AES-256-GCM 암호문(ERD §6).
 * - branch_id(단계 8 추가)는 BR-102 거점 범위 판정용: 관련 주문 거점, 주문이 없으면 고객 기본 주소 거점.
 */
import { type AnyPgColumn, bigint, boolean, date, index, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { adminUser, branch } from './d1-org';
import { customer } from './d2-customer';
import { serviceOrder } from './d5-order';
import { consultation } from './d6-consult';
import { technician } from './d7-technician';
import { auditColumns, idColumn } from './common';

/** 2.6.3 독촉·전달 (A-CSL-030 → 기사 앱 T-NTF-020, 현황 A-PRC-060) */
export const followupRequest = pgTable(
  'followup_request',
  {
    id: idColumn(),
    consultationId: bigint('consultation_id', { mode: 'number' })
      .notNull()
      .references(() => consultation.id),
    targetType: varchar('target_type', { length: 20 }).notNull(), // FOLLOWUP_TARGET
    targetOrderId: bigint('target_order_id', { mode: 'number' }).references(() => serviceOrder.id),
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    followupCount: integer('followup_count').notNull(),
    followupType: varchar('followup_type', { length: 20 }).notNull(), // FOLLOWUP_TYPE
    cause: varchar('cause', { length: 30 }), // FOLLOWUP_CAUSE
    message: varchar('message', { length: 500 }).notNull(),
    receiverTechId: bigint('receiver_tech_id', { mode: 'number' }).references(() => technician.id),
    receiverAdminId: bigint('receiver_admin_id', { mode: 'number' }).references(() => adminUser.id),
    status: varchar('status', { length: 20 }).notNull(), // FOLLOWUP_STATUS (01 §3.15)
    reply: varchar('reply', { length: 500 }),
    readAt: timestamp('read_at', { withTimezone: true }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    index('followup_request_order_idx').on(t.targetOrderId),
    index('followup_request_tech_idx').on(t.receiverTechId, t.status),
    index('followup_request_created_idx').on(t.createdAt),
  ],
);

/** 2.6.4 안전사고 */
export const safetyIncident = pgTable(
  'safety_incident',
  {
    id: idColumn(),
    incidentNo: varchar('incident_no', { length: 20 }).notNull().unique(),
    consultationId: bigint('consultation_id', { mode: 'number' }).references(() => consultation.id),
    customerId: bigint('customer_id', { mode: 'number' }).references(() => customer.id),
    orderId: bigint('order_id', { mode: 'number' }).references(() => serviceOrder.id),
    technicianId: bigint('technician_id', { mode: 'number' }).references(() => technician.id),
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    damageType: varchar('damage_type', { length: 30 }).notNull(), // DAMAGE_TYPE
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    circumstance: text('circumstance').notNull(),
    damageDetail: text('damage_detail').notNull(),
    customerDemand: text('customer_demand'),
    responseAction: text('response_action'),
    mediaFlags: varchar('media_flags', { length: 100 }), // MEDIA_FLAG 쉼표 구분
    isEscalated: boolean('is_escalated').notNull().default(false),
    insuranceClaimNo: varchar('insurance_claim_no', { length: 50 }),
    compensationAmount: integer('compensation_amount'),
    status: varchar('status', { length: 20 }).notNull(), // INCIDENT_STATUS (01 §3.14)
    ...auditColumns,
  },
  (t) => [index('safety_incident_customer_idx').on(t.customerId), index('safety_incident_created_idx').on(t.createdAt)],
);

/** 2.6.5 안전사고 통보 수신자 */
export const incidentRecipient = pgTable(
  'incident_recipient',
  {
    id: idColumn(),
    incidentId: bigint('incident_id', { mode: 'number' })
      .notNull()
      .references(() => safetyIncident.id),
    recipientType: varchar('recipient_type', { length: 20 }).notNull(), // INCIDENT_RECIPIENT_TYPE
    adminUserId: bigint('admin_user_id', { mode: 'number' }).references(() => adminUser.id),
    name: varchar('name', { length: 50 }),
    org: varchar('org', { length: 50 }),
    phone: varchar('phone', { length: 100 }), // 🔒
    email: varchar('email', { length: 100 }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    notifyResult: varchar('notify_result', { length: 20 }), // NOTIFICATION_STATUS
    ...auditColumns,
  },
  (t) => [index('incident_recipient_incident_idx').on(t.incidentId)],
);

/** 2.12.8 AS·보증 재방문 (BR-050·051) */
export const asRequest = pgTable(
  'as_request',
  {
    id: idColumn(),
    asNo: varchar('as_no', { length: 20 }).notNull().unique(),
    originalOrderId: bigint('original_order_id', { mode: 'number' })
      .notNull()
      .references(() => serviceOrder.id),
    newOrderId: bigint('new_order_id', { mode: 'number' }).references(() => serviceOrder.id),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customer.id),
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    reason: varchar('reason', { length: 20 }).notNull(), // AS_REASON
    content: varchar('content', { length: 1000 }),
    photoFileIds: varchar('photo_file_ids', { length: 200 }),
    isWarranty: boolean('is_warranty').notNull(),
    warrantyUntil: date('warranty_until', { mode: 'string' }),
    responsibleTechId: bigint('responsible_tech_id', { mode: 'number' }).references(() => technician.id),
    status: varchar('status', { length: 20 }).notNull(), // AS_STATUS (01 §3.12)
    handledBy: bigint('handled_by', { mode: 'number' }).references(() => adminUser.id),
    handleNote: varchar('handle_note', { length: 500 }),
    ...auditColumns,
  },
  (t) => [index('as_request_original_idx').on(t.originalOrderId), index('as_request_status_idx').on(t.status, t.createdAt)],
);

/** 2.6.6 VOC·클레임 */
export const voc = pgTable(
  'voc',
  {
    id: idColumn(),
    vocNo: varchar('voc_no', { length: 20 }).notNull().unique(),
    consultationId: bigint('consultation_id', { mode: 'number' }).references(() => consultation.id),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customer.id),
    orderId: bigint('order_id', { mode: 'number' }).references(() => serviceOrder.id),
    technicianId: bigint('technician_id', { mode: 'number' }).references(() => technician.id),
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    channel: varchar('channel', { length: 20 }).notNull(), // VOC_CHANNEL
    vocType: varchar('voc_type', { length: 20 }).notNull(), // VOC_TYPE
    categoryL: varchar('category_l', { length: 30 }), // VOC_CATEGORY_L
    categoryM: varchar('category_m', { length: 30 }), // VOC_CATEGORY_M
    title: varchar('title', { length: 200 }).notNull(),
    content: text('content').notNull(),
    severity: varchar('severity', { length: 10 }), // VOC_SEVERITY
    isAlert: boolean('is_alert').notNull().default(false),
    status: varchar('status', { length: 20 }).notNull(), // VOC_STATUS (01 §3.13)
    handlerAdminId: bigint('handler_admin_id', { mode: 'number' }).references(() => adminUser.id),
    rootCause: varchar('root_cause', { length: 500 }),
    customerAction: varchar('customer_action', { length: 500 }),
    linkedAsRequestId: bigint('linked_as_request_id', { mode: 'number' }).references((): AnyPgColumn => asRequest.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [index('voc_customer_status_idx').on(t.customerId, t.status), index('voc_created_idx').on(t.createdAt), index('voc_tech_idx').on(t.technicianId)],
);

/** 2.6.8 VOC 처리 이력 (단계 8 추가, 01 §0.3-9) — INSERT ONLY */
export const vocHistory = pgTable(
  'voc_history',
  {
    id: idColumn(),
    vocId: bigint('voc_id', { mode: 'number' })
      .notNull()
      .references(() => voc.id),
    fromStatus: varchar('from_status', { length: 20 }),
    toStatus: varchar('to_status', { length: 20 }).notNull(),
    memo: varchar('memo', { length: 500 }),
    actorType: varchar('actor_type', { length: 20 }).notNull(), // ACTOR_TYPE
    actorId: bigint('actor_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('voc_history_voc_idx').on(t.vocId, t.createdAt)],
);
