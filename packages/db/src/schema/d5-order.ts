/** D5 주문(접수) (01_ERD §2.5) · D8 슬롯 (§2.8.1) — 단계 2 */
import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  smallint,
  time,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { adminUser, branch } from './d1-org';
import { customer, customerAddress } from './d2-customer';
import { serviceOption, serviceProduct, surchargeRule } from './d3-product';
import { quote } from './d4-quote';
import { auditColumns, idColumn, softDelete } from './common';

/**
 * 2.5.1 서비스 주문. consultation_id(단계 3)·coupon_id(단계 9)의 FK는 해당 테이블이 생기는 단계에서 건다.
 * status 변경은 packages/domain 주문 상태 전이(assertOrderTransition)를 거치고 order_status_history 에 1행 INSERT 한다.
 */
export const serviceOrder = pgTable(
  'service_order',
  {
    id: idColumn(),
    orderNo: varchar('order_no', { length: 20 }).notNull().unique(),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customer.id),
    addressId: bigint('address_id', { mode: 'number' })
      .notNull()
      .references(() => customerAddress.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    quoteId: bigint('quote_id', { mode: 'number' }).references(() => quote.id),
    consultationId: bigint('consultation_id', { mode: 'number' }),
    parentOrderId: bigint('parent_order_id', { mode: 'number' }).references((): AnyPgColumn => serviceOrder.id),
    channel: varchar('channel', { length: 20 }).notNull(), // ORDER_CHANNEL
    orderType: varchar('order_type', { length: 20 }).notNull(), // ORDER_TYPE
    status: varchar('status', { length: 20 }).notNull(), // ORDER_STATUS (01 §3.1)
    pendingReason: varchar('pending_reason', { length: 30 }),
    cancelReason: varchar('cancel_reason', { length: 30 }),
    requestedDate: date('requested_date', { mode: 'string' }),
    requestedTimeFrom: time('requested_time_from'),
    requestedTimeTo: time('requested_time_to'),
    promisedAt: timestamp('promised_at', { withTimezone: true }),
    arrivalWindowStart: timestamp('arrival_window_start', { withTimezone: true }),
    arrivalWindowEnd: timestamp('arrival_window_end', { withTimezone: true }),
    visitType: varchar('visit_type', { length: 20 }), // VISIT_TYPE
    requiredTechCount: smallint('required_tech_count').notNull().default(1),
    customerRequest: varchar('customer_request', { length: 500 }),
    internalNote: varchar('internal_note', { length: 1000 }),
    subtotalAmount: integer('subtotal_amount').notNull(),
    discountAmount: integer('discount_amount').notNull().default(0),
    surchargeAmount: integer('surcharge_amount').notNull().default(0),
    extraAmount: integer('extra_amount').notNull().default(0),
    totalAmount: integer('total_amount').notNull(),
    paidAmount: integer('paid_amount').notNull().default(0),
    paymentStatus: varchar('payment_status', { length: 20 }).notNull(), // PAYMENT_STATUS
    couponId: bigint('coupon_id', { mode: 'number' }),
    isDuplicateChecked: boolean('is_duplicate_checked').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    ...auditColumns,
    ...softDelete,
  },
  (t) => [
    index('service_order_branch_status_promised_idx').on(t.branchId, t.status, t.promisedAt),
    index('service_order_customer_status_idx').on(t.customerId, t.status),
    index('service_order_promised_idx').on(t.promisedAt),
  ],
);

/** 2.5.2 주문 상세. customer_device_id 의 FK는 customer_device 테이블이 생기는 단계(9)에서 건다. */
export const orderItem = pgTable(
  'order_item',
  {
    id: idColumn(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => serviceOrder.id),
    itemType: varchar('item_type', { length: 20 }).notNull(), // QUOTE_ITEM_TYPE
    productId: bigint('product_id', { mode: 'number' }).references(() => serviceProduct.id),
    optionId: bigint('option_id', { mode: 'number' }).references(() => serviceOption.id),
    surchargeRuleId: bigint('surcharge_rule_id', { mode: 'number' }).references(() => surchargeRule.id),
    customerDeviceId: bigint('customer_device_id', { mode: 'number' }),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price').notNull(),
    amount: integer('amount').notNull(),
    itemStatus: varchar('item_status', { length: 20 }).notNull().default('PLANNED'), // ITEM_STATUS
    skipReason: varchar('skip_reason', { length: 200 }),
  },
  (t) => [index('order_item_order_idx').on(t.orderId)],
);

/** 2.5.3 주문 상태 이력 (INSERT ONLY — DB 트리거로 UPDATE/DELETE 차단) */
export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: idColumn(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => serviceOrder.id),
    fromStatus: varchar('from_status', { length: 20 }),
    toStatus: varchar('to_status', { length: 20 }).notNull(),
    reasonCode: varchar('reason_code', { length: 30 }),
    memo: varchar('memo', { length: 500 }),
    actorType: varchar('actor_type', { length: 20 }).notNull(), // ACTOR_TYPE
    actorId: bigint('actor_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_status_history_order_idx').on(t.orderId, t.createdAt)],
);

/** 2.5.4 고객 일정변경·취소 요청 */
export const orderChangeRequest = pgTable(
  'order_change_request',
  {
    id: idColumn(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => serviceOrder.id),
    requestType: varchar('request_type', { length: 20 }).notNull(), // CHANGE_REQUEST_TYPE
    requestedDate: date('requested_date', { mode: 'string' }),
    requestedTime: time('requested_time'),
    reason: varchar('reason', { length: 500 }),
    status: varchar('status', { length: 20 }).notNull(), // CHANGE_REQUEST_STATUS
    handledBy: bigint('handled_by', { mode: 'number' }).references(() => adminUser.id),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [index('order_change_request_status_idx').on(t.status, t.createdAt)],
);

/** 2.8.1 거점 운영 슬롯. 예약 시 `booked_count < capacity` 조건부 UPDATE (BR-021) */
export const timeSlot = pgTable(
  'time_slot',
  {
    id: idColumn(),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    slotDate: date('slot_date', { mode: 'string' }).notNull(),
    slotHour: smallint('slot_hour').notNull(),
    slotKind: varchar('slot_kind', { length: 20 }).notNull(), // SLOT_KIND
    capacity: integer('capacity').notNull(),
    bookedCount: integer('booked_count').notNull().default(0),
    isClosed: boolean('is_closed').notNull().default(false),
    ...auditColumns,
  },
  (t) => [uniqueIndex('time_slot_branch_date_hour_kind_uk').on(t.branchId, t.slotDate, t.slotHour, t.slotKind)],
);
