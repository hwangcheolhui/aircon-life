/** D4 견적 (01_ERD §2.4) — 단계 1 */
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import type { QuoteSnapshot } from '@aircon/domain';
import { branch } from './d1-org';
import { customer, customerAddress } from './d2-customer';
import { serviceOption, serviceProduct, surchargeRule } from './d3-product';
import { auditColumns, idColumn } from './common';

/**
 * 2.4.1 견적. 비회원 견적이면 customer_id 가 NULL (F-CUS-AUTH-02).
 * customer_id·address_id 의 FK는 단계 2 마이그레이션(0003)에서 걸었다. 예약 시 주문 고객·주소로 채운다.
 */
export const quote = pgTable(
  'quote',
  {
    id: idColumn(),
    quoteNo: varchar('quote_no', { length: 20 }).notNull().unique(),
    customerId: bigint('customer_id', { mode: 'number' }).references(() => customer.id),
    guestPhoneHash: char('guest_phone_hash', { length: 64 }),
    channel: varchar('channel', { length: 20 }).notNull(), // ORDER_CHANNEL (APP/PHONE/B2B)
    addressId: bigint('address_id', { mode: 'number' }).references(() => customerAddress.id),
    legalDongCode: varchar('legal_dong_code', { length: 10 }).notNull(),
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    isServiceable: boolean('is_serviceable').notNull(),
    subtotalAmount: integer('subtotal_amount').notNull(),
    discountAmount: integer('discount_amount').notNull().default(0),
    surchargeAmount: integer('surcharge_amount').notNull().default(0),
    totalAmount: integer('total_amount').notNull(),
    estimatedDurationMin: integer('estimated_duration_min'),
    status: varchar('status', { length: 20 }).notNull(), // QUOTE_STATUS (01 §3.8)
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    priceSnapshotJson: jsonb('price_snapshot_json').$type<QuoteSnapshot>(),
    ...auditColumns,
  },
  (t) => [index('quote_status_expires_idx').on(t.status, t.expiresAt)],
);

/** 2.4.2 견적 상세. customer_device_id 의 FK는 customer_device 테이블이 생기는 단계에서 건다. */
export const quoteItem = pgTable(
  'quote_item',
  {
    id: idColumn(),
    quoteId: bigint('quote_id', { mode: 'number' })
      .notNull()
      .references(() => quote.id),
    itemType: varchar('item_type', { length: 20 }).notNull(), // QUOTE_ITEM_TYPE
    productId: bigint('product_id', { mode: 'number' }).references(() => serviceProduct.id),
    optionId: bigint('option_id', { mode: 'number' }).references(() => serviceOption.id),
    surchargeRuleId: bigint('surcharge_rule_id', { mode: 'number' }).references(() => surchargeRule.id),
    customerDeviceId: bigint('customer_device_id', { mode: 'number' }),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price').notNull(),
    amount: integer('amount').notNull(),
  },
  (t) => [index('quote_item_quote_idx').on(t.quoteId)],
);
