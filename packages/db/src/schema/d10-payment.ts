/**
 * D10 결제 (01_ERD §2.10.1~2) · D12 알림 (§2.12.1~2) — 단계 2.
 * payment·refund 는 INSERT ONLY(CLAUDE.md §5): 결제는 PG 확인 후 최종 상태(APPROVED/FAILED)로 1행, 취소·환불은 refund 행으로 남긴다.
 */
import { bigint, boolean, index, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { adminUser } from './d1-org';
import { customer } from './d2-customer';
import { serviceOrder } from './d5-order';
import { technician } from './d7-technician';
import { auditColumns, idColumn } from './common';

/** 2.10.1 결제 */
export const payment = pgTable(
  'payment',
  {
    id: idColumn(),
    paymentNo: varchar('payment_no', { length: 30 }).notNull().unique(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => serviceOrder.id),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customer.id),
    paymentStage: varchar('payment_stage', { length: 20 }).notNull(), // PAYMENT_STAGE
    method: varchar('method', { length: 20 }).notNull(), // PAYMENT_METHOD
    amount: integer('amount').notNull(),
    status: varchar('status', { length: 20 }).notNull(), // PAYMENT_TX_STATUS
    pgProvider: varchar('pg_provider', { length: 20 }), // PG_PROVIDER
    pgTid: varchar('pg_tid', { length: 100 }).unique(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    failReason: varchar('fail_reason', { length: 300 }),
    collectedByTechId: bigint('collected_by_tech_id', { mode: 'number' }).references(() => technician.id),
    receiptUrl: varchar('receipt_url', { length: 300 }),
    ...auditColumns,
  },
  (t) => [index('payment_order_idx').on(t.orderId)],
);

/** 2.10.2 환불·취소 */
export const refund = pgTable(
  'refund',
  {
    id: idColumn(),
    paymentId: bigint('payment_id', { mode: 'number' })
      .notNull()
      .references(() => payment.id),
    amount: integer('amount').notNull(),
    reasonCode: varchar('reason_code', { length: 30 }).notNull(), // REFUND_REASON
    reasonDetail: varchar('reason_detail', { length: 300 }),
    cancelFee: integer('cancel_fee').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull(), // REFUND_STATUS
    pgCancelTid: varchar('pg_cancel_tid', { length: 100 }),
    requestedBy: varchar('requested_by', { length: 20 }), // ACTOR_TYPE (CUSTOMER/ADMIN)
    approvedBy: bigint('approved_by', { mode: 'number' }).references(() => adminUser.id),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [index('refund_payment_idx').on(t.paymentId)],
);

/** 2.12.1 알림 템플릿 */
export const notificationTemplate = pgTable('notification_template', {
  id: idColumn(),
  templateCode: varchar('template_code', { length: 30 }).notNull().unique(),
  channel: varchar('channel', { length: 20 }).notNull(), // NOTIFICATION_CHANNEL
  target: varchar('target', { length: 20 }).notNull(), // NOTIFICATION_TARGET
  title: varchar('title', { length: 100 }).notNull(),
  body: text('body').notNull(),
  kakaoTemplateId: varchar('kakao_template_id', { length: 50 }),
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns,
});

/** 2.12.2 알림 발송 이력 */
export const notificationLog = pgTable(
  'notification_log',
  {
    id: idColumn(),
    templateId: bigint('template_id', { mode: 'number' }).references(() => notificationTemplate.id),
    receiverType: varchar('receiver_type', { length: 20 }).notNull(), // NOTIFICATION_TARGET
    receiverId: bigint('receiver_id', { mode: 'number' }),
    receiverPhoneMasked: varchar('receiver_phone_masked', { length: 20 }),
    channel: varchar('channel', { length: 20 }).notNull(),
    relatedType: varchar('related_type', { length: 20 }), // ORDER / CAMPAIGN …
    relatedId: bigint('related_id', { mode: 'number' }),
    status: varchar('status', { length: 20 }).notNull(), // NOTIFICATION_STATUS
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failReason: varchar('fail_reason', { length: 300 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notification_log_receiver_idx').on(t.receiverType, t.receiverId, t.createdAt),
    index('notification_log_related_idx').on(t.relatedType, t.relatedId),
  ],
);

/**
 * 2.10.3 증빙(현금영수증·세금계산서) — 단계 6. 발행 상태가 바뀌므로 INSERT ONLY 가 아니다(01 §3.11 전이표).
 * identity_no 🔒 는 앱 레벨 암호화(휴대폰·사업자번호), 목록은 마스킹만.
 */
export const taxDocument = pgTable(
  'tax_document',
  {
    id: idColumn(),
    paymentId: bigint('payment_id', { mode: 'number' }).references(() => payment.id),
    corporateAccountId: bigint('corporate_account_id', { mode: 'number' }), // 단계 11 B2B 월합산(corporate_account)
    docType: varchar('doc_type', { length: 20 }).notNull(), // TAX_DOC_TYPE
    identityNo: varchar('identity_no', { length: 200 }), // 🔒 암호문
    supplyAmount: integer('supply_amount').notNull(),
    vatAmount: integer('vat_amount').notNull(),
    totalAmount: integer('total_amount').notNull(),
    issueStatus: varchar('issue_status', { length: 20 }).notNull(), // TAX_ISSUE_STATUS
    issuedNo: varchar('issued_no', { length: 50 }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    failReason: varchar('fail_reason', { length: 300 }),
    requestedBy: varchar('requested_by', { length: 20 }), // ACTOR_TYPE (CUSTOMER/TECHNICIAN/ADMIN)
    ...auditColumns,
  },
  (t) => [index('tax_document_payment_idx').on(t.paymentId), index('tax_document_status_idx').on(t.issueStatus)],
);
