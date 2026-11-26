/**
 * D12 CRM (01_ERD §2.12.3·2.12.4) — 단계 8-2 재방문 자동 캠페인(F-ADM-CRM-01, F-SYS-06, BR-091·101).
 * coupon_id 의 FK 는 coupon 테이블이 생기는 단계(9)에서 건다.
 */
import { bigint, index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
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
  couponId: bigint('coupon_id', { mode: 'number' }),
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
