/**
 * D6 상담 (01_ERD §2.6.1·2.6.2·2.6.7) — 단계 3 상담 콘솔.
 * 독촉·안전사고·VOC(§2.6.3~2.6.6)는 단계 8 d6-aftercare.ts.
 * 🔒 caller_phone 은 AES-256-GCM 암호문, 검색은 caller_phone_hash 로만(ERD §6).
 */
import { bigint, boolean, char, index, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { adminUser } from './d1-org';
import { customer } from './d2-customer';
import { serviceOrder } from './d5-order';
import { auditColumns, idColumn } from './common';

/** 2.6.1 통화 기록. CTI 연동(F-ADM-CSL-17, 단계 11) 전에는 상담원이 고객을 확정할 때 수기로 1행 만든다 */
export const callLog = pgTable(
  'call_log',
  {
    id: idColumn(),
    direction: varchar('direction', { length: 10 }).notNull(), // CALL_DIRECTION
    callerPhone: varchar('caller_phone', { length: 100 }).notNull(), // 🔒
    callerPhoneHash: char('caller_phone_hash', { length: 64 }),
    customerId: bigint('customer_id', { mode: 'number' }).references(() => customer.id),
    agentAdminId: bigint('agent_admin_id', { mode: 'number' }).references(() => adminUser.id),
    ivrPath: varchar('ivr_path', { length: 50 }),
    waitSeconds: integer('wait_seconds'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    recordingUrl: varchar('recording_url', { length: 300 }),
    ...auditColumns,
  },
  (t) => [index('call_log_caller_phone_hash_idx').on(t.callerPhoneHash), index('call_log_customer_idx').on(t.customerId, t.startedAt)],
);

/** 2.6.2 상담 건. 상태 변경은 packages/domain 상담 전이(assertConsultTransition)를 거친다 */
export const consultation = pgTable(
  'consultation',
  {
    id: idColumn(),
    consultNo: varchar('consult_no', { length: 20 }).notNull().unique(),
    customerId: bigint('customer_id', { mode: 'number' }).references(() => customer.id),
    callLogId: bigint('call_log_id', { mode: 'number' }).references(() => callLog.id),
    channel: varchar('channel', { length: 20 }).notNull(), // CONSULT_CHANNEL
    consultType: varchar('consult_type', { length: 20 }).notNull(), // CONSULT_TYPE
    subType: varchar('sub_type', { length: 30 }), // ORDER: ORDER_SYMPTOM / INQUIRY·CLAIM: INQUIRY_SUB_TYPE
    relatedOrderId: bigint('related_order_id', { mode: 'number' }).references(() => serviceOrder.id),
    content: text('content'),
    status: varchar('status', { length: 20 }).notNull(), // CONSULT_STATUS (01 §3.5)
    agentAdminId: bigint('agent_admin_id', { mode: 'number' }).references(() => adminUser.id),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** 1:1 문의 답변 (C-CS-020 · A-CSL-080, 단계 8) */
    replyContent: text('reply_content'),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    repliedBy: bigint('replied_by', { mode: 'number' }).references(() => adminUser.id),
    ...auditColumns,
  },
  (t) => [
    index('consultation_customer_status_idx').on(t.customerId, t.status),
    index('consultation_created_idx').on(t.createdAt),
  ],
);

/** 2.6.7 상담 스크립트/응대 멘트 (A-CNT-050, F-ADM-CSL-16) */
export const consultScript = pgTable('consult_script', {
  id: idColumn(),
  scriptCode: varchar('script_code', { length: 30 }).notNull().unique(),
  title: varchar('title', { length: 100 }).notNull(),
  content: text('content').notNull(),
  triggerPoint: varchar('trigger_point', { length: 30 }).notNull(), // SCRIPT_TRIGGER
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns,
});
