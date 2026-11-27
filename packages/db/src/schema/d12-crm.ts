/**
 * D12 CRM (01_ERD §2.12.3~2.12.7) — 단계 8-2 재방문 자동 캠페인(F-ADM-CRM-01, F-SYS-06, BR-091·101).
 * 단계 9: 시즌·타겟 캠페인(F-ADM-CRM-02), 고객 쿠폰(F-CUS-CPN-01·F-CUS-PAY-04·F-ADM-CRM-03), 후기(F-CUS-REV-01·F-ADM-VOC-04, BR-090).
 */
import { bigint, boolean, index, jsonb, pgTable, smallint, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { coupon } from './d3-product';
import { technician } from './d7-technician';
import { voc } from './d6-aftercare';
import { customer } from './d2-customer';
import { serviceOrder } from './d5-order';
import { notificationTemplate } from './d10-payment';
import { auditColumns, idColumn } from './common';

/** 2.12.3 캠페인 */
export const campaign = pgTable('campaign', {
  id: idColumn(),
  name: varchar('name', { length: 100 }).notNull(),
  campaignType: varchar('campaign_type', { length: 20 }).notNull(), // CAMPAIGN_TYPE
  targetRuleJson: jsonb('target_rule_json'),
  templateId: bigint('template_id', { mode: 'number' }).references(() => notificationTemplate.id),
  couponId: bigint('coupon_id', { mode: 'number' }).references(() => coupon.id),
  scheduleType: varchar('schedule_type', { length: 20 }), // CAMPAIGN_SCHEDULE
  sendAt: timestamp('send_at', { withTimezone: true }),
  status: varchar('status', { length: 20 }).notNull(), // CAMPAIGN_STATUS
  ...auditColumns,
});

/** 2.12.4 캠페인 대상·성과 */
export const campaignTarget = pgTable(
  'campaign_target',
  {
    id: idColumn(),
    campaignId: bigint('campaign_id', { mode: 'number' })
      .notNull()
      .references(() => campaign.id),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customer.id),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    convertedOrderId: bigint('converted_order_id', { mode: 'number' }).references(() => serviceOrder.id),
    status: varchar('status', { length: 20 }).notNull(), // CAMPAIGN_TARGET_STATUS
    ...auditColumns,
  },
  (t) => [index('campaign_target_campaign_idx').on(t.campaignId, t.createdAt), index('campaign_target_customer_idx').on(t.customerId)],
);

/** 2.12.6 고객 쿠폰 (단계 9). 같은 쿠폰은 고객당 1장. 상태 ISSUED → USED(주문에 사용), 기간이 지나면 화면에서 만료 */
export const customerCoupon = pgTable(
  'customer_coupon',
  {
    id: idColumn(),
    couponId: bigint('coupon_id', { mode: 'number' })
      .notNull()
      .references(() => coupon.id),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customer.id),
    status: varchar('status', { length: 20 }).notNull(), // CUSTOMER_COUPON_STATUS
    usedOrderId: bigint('used_order_id', { mode: 'number' }).references(() => serviceOrder.id),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    campaignId: bigint('campaign_id', { mode: 'number' }).references(() => campaign.id), // 캠페인 동봉 발급(단계 9)
    issuedBy: bigint('issued_by', { mode: 'number' }),
  },
  (t) => [uniqueIndex('customer_coupon_uk').on(t.couponId, t.customerId), index('customer_coupon_customer_idx').on(t.customerId, t.status)],
);

/** 2.12.7 후기·평점 (단계 9). 주문당 1건. BR-090 저평점은 VOC 자동 생성(voc_id) */
export const review = pgTable(
  'review',
  {
    id: idColumn(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => serviceOrder.id),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customer.id),
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    branchId: bigint('branch_id', { mode: 'number' }), // 주문 거점(BR-102 거점 범위 조회, 단계 9)
    rating: smallint('rating').notNull(),
    npsScore: smallint('nps_score'),
    tags: varchar('tags', { length: 200 }),
    content: varchar('content', { length: 1000 }),
    photoFileIds: varchar('photo_file_ids', { length: 200 }),
    isPublic: boolean('is_public').notNull().default(true),
    adminReply: varchar('admin_reply', { length: 1000 }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    isHidden: boolean('is_hidden').notNull().default(false),
    vocId: bigint('voc_id', { mode: 'number' }).references(() => voc.id),
    ...auditColumns,
  },
  (t) => [uniqueIndex('review_order_uk').on(t.orderId), index('review_tech_idx').on(t.technicianId), index('review_created_idx').on(t.createdAt)],
);
