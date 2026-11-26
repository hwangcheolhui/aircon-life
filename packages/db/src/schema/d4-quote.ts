/** D4 견적 (01_ERD §2.4) — 단계 1 */
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import type { QuoteSnapshot } from '@aircon/domain';
import { branch } from './d1-org';
import { customer, customerAddress, customerDevice } from './d2-customer';
import { attachment } from './d13-system';
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

/** 2.4.2 견적 상세. customer_device_id = 원클릭 재예약(F-CUS-DEV-02)의 대상 기기(단계 9) */
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
    customerDeviceId: bigint('customer_device_id', { mode: 'number' }).references(() => customerDevice.id),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price').notNull(),
    amount: integer('amount').notNull(),
  },
  (t) => [index('quote_item_quote_idx').on(t.quoteId)],
);

/**
 * 2.4.3 기기 이미지 인식 (단계 9, F-CUS-QUO-05). 비회원 견적 중에 올리므로 처음엔 quote_id 가 비어 있고,
 * 견적을 발행하면 연결한다. 인식은 이미지 인식 어댑터(VISION_DRIVER=mock, 실연동은 업체 선정 후).
 */
export const deviceImage = pgTable(
  'device_image',
  {
    id: idColumn(),
    quoteId: bigint('quote_id', { mode: 'number' }).references(() => quote.id),
    customerDeviceId: bigint('customer_device_id', { mode: 'number' }).references(() => customerDevice.id),
    fileId: bigint('file_id', { mode: 'number' })
      .notNull()
      .references(() => attachment.id),
    purpose: varchar('purpose', { length: 20 }).notNull(), // IMAGE_PURPOSE
    recognizedType: varchar('recognized_type', { length: 30 }),
    recognizedBrand: varchar('recognized_brand', { length: 30 }),
    dirtLevel: varchar('dirt_level', { length: 10 }), // DIRT_LEVEL
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    userConfirmed: boolean('user_confirmed'),
    confirmedType: varchar('confirmed_type', { length: 30 }), // 고객이 확인·수정한 형태(단계 9)
    ...auditColumns,
  },
  (t) => [index('device_image_quote_idx').on(t.quoteId)],
);
