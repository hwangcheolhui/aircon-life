/**
 * D9 현장작업 (01_ERD §2.9) — 단계 5-1: 작업 건(work_order)·기기별 결과(work_result)·작업 사진(work_photo)·활동 내역(activity_log).
 * 단계 5-2: 현장 추가요금(extra_charge). 자재(material_usage 등)는 단계 9.
 * 기기 단위: 주문 항목(order_item) 수량만큼 기기가 있고, 결과·사진은 (order_item_id, unit_no)로 기기를 가리킨다(고객 보유 기기 customer_device 는 단계 9).
 */
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { surchargeRule } from './d3-product';
import { orderItem, serviceOrder } from './d5-order';
import { adminUser } from './d1-org';
import { attachment } from './d13-system';
import { technician } from './d7-technician';
import { auditColumns, idColumn, softDelete } from './common';

/** 2.9.1 작업(현장 처리) 건. 주문 1건당 1개 */
export const workOrder = pgTable(
  'work_order',
  {
    id: idColumn(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => serviceOrder.id),
    mainTechnicianId: bigint('main_technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    status: varchar('status', { length: 20 }).notNull(), // WORK_STATUS (01 §3.2)
    departedAt: timestamp('departed_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    workMinutes: integer('work_minutes'),
    resultCode: varchar('result_code', { length: 30 }), // RESULT_CODE
    pendingCode: varchar('pending_code', { length: 30 }), // PENDING_REASON (단계 5-2)
    dirtLevel: varchar('dirt_level', { length: 10 }), // DIRT_LEVEL
    workNote: text('work_note'),
    internalNote: text('internal_note'),
    issueFound: varchar('issue_found', { length: 500 }),
    repairGuided: boolean('repair_guided').notNull().default(false),
    highPlaceWork: boolean('high_place_work'),
    safetyChecklistDone: boolean('safety_checklist_done').notNull().default(false),
    customerSignatureFileId: bigint('customer_signature_file_id', { mode: 'number' }).references(() => attachment.id),
    laborAmount: integer('labor_amount'),
    extraAmount: integer('extra_amount').notNull().default(0),
    materialAmount: integer('material_amount').notNull().default(0),
    discountAmount: integer('discount_amount').notNull().default(0),
    finalAmount: integer('final_amount'),
    receivedAmount: integer('received_amount').notNull().default(0),
    isSettlementTarget: boolean('is_settlement_target').notNull().default(false),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('work_order_order_uk').on(t.orderId),
    index('work_order_tech_status_idx').on(t.mainTechnicianId, t.status),
  ],
);

/** 2.9.2 기기별 처리 결과. 기기 = (order_item_id, unit_no) */
export const workResult = pgTable(
  'work_result',
  {
    id: idColumn(),
    workOrderId: bigint('work_order_id', { mode: 'number' })
      .notNull()
      .references(() => workOrder.id),
    orderItemId: bigint('order_item_id', { mode: 'number' })
      .notNull()
      .references(() => orderItem.id),
    unitNo: smallint('unit_no').notNull().default(1),
    customerDeviceId: bigint('customer_device_id', { mode: 'number' }), // customer_device 는 단계 9 (FK 는 그때)
    result: varchar('result', { length: 20 }).notNull(), // WORK_RESULT
    conditionNote: varchar('condition_note', { length: 300 }),
    recommendNext: smallint('recommend_next'),
    ...auditColumns,
  },
  (t) => [uniqueIndex('work_result_unit_uk').on(t.workOrderId, t.orderItemId, t.unitNo)],
);

/** 2.9.3 작업 전·후 사진. 완료 시 작업한 기기마다 BEFORE·AFTER 각 1장 이상(BR-041) */
export const workPhoto = pgTable(
  'work_photo',
  {
    id: idColumn(),
    workOrderId: bigint('work_order_id', { mode: 'number' })
      .notNull()
      .references(() => workOrder.id),
    orderItemId: bigint('order_item_id', { mode: 'number' }).references(() => orderItem.id),
    unitNo: smallint('unit_no'),
    customerDeviceId: bigint('customer_device_id', { mode: 'number' }),
    photoType: varchar('photo_type', { length: 20 }).notNull(), // PHOTO_TYPE
    fileId: bigint('file_id', { mode: 'number' })
      .notNull()
      .references(() => attachment.id),
    takenAt: timestamp('taken_at', { withTimezone: true }),
    marketingAgree: boolean('marketing_agree').notNull().default(false),
    ...auditColumns,
  },
  (t) => [index('work_photo_work_idx').on(t.workOrderId)],
);

/** 2.9.8 활동 내역(주문 타임라인: 통화·문자·방문 시도·메모) */
export const activityLog = pgTable(
  'activity_log',
  {
    id: idColumn(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => serviceOrder.id),
    actorType: varchar('actor_type', { length: 20 }).notNull(), // ACTOR_TYPE
    actorId: bigint('actor_id', { mode: 'number' }),
    activityType: varchar('activity_type', { length: 20 }).notNull(), // ACTIVITY_TYPE
    content: varchar('content', { length: 500 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('activity_log_order_idx').on(t.orderId, t.createdAt)],
);

/**
 * 2.9.4 현장 추가요금 (단계 5-2). BR-040 고객 동의 없이는 청구하지 않고, BR-042 기타(ETC)는 관리자 승인 후 고객 동의 요청.
 * 상태 = approval_status · customer_agreed · agreed_at(고객 응답 시각: 동의·거절) · deleted_at(기사 철회) — packages/domain extraChargeState.
 * DEVICE_ADD(현장 기기 추가)는 base_order_item_id 상품을 quantity 대 더하고, 동의되면 새 주문 항목(order_item_id)을 만든다.
 */
export const extraCharge = pgTable(
  'extra_charge',
  {
    id: idColumn(),
    workOrderId: bigint('work_order_id', { mode: 'number' })
      .notNull()
      .references(() => workOrder.id),
    surchargeRuleId: bigint('surcharge_rule_id', { mode: 'number' }).references(() => surchargeRule.id),
    chargeType: varchar('charge_type', { length: 20 }).notNull(), // EXTRA_CHARGE_TYPE
    title: varchar('title', { length: 100 }).notNull(),
    quantity: smallint('quantity').notNull().default(1),
    baseOrderItemId: bigint('base_order_item_id', { mode: 'number' }).references(() => orderItem.id),
    orderItemId: bigint('order_item_id', { mode: 'number' }).references(() => orderItem.id),
    amount: integer('amount').notNull(),
    reason: varchar('reason', { length: 300 }).notNull(),
    evidenceFileId: bigint('evidence_file_id', { mode: 'number' }).references(() => attachment.id),
    customerAgreed: boolean('customer_agreed').notNull().default(false),
    agreedMethod: varchar('agreed_method', { length: 20 }), // EXTRA_AGREED_METHOD
    agreedAt: timestamp('agreed_at', { withTimezone: true }),
    signatureFileId: bigint('signature_file_id', { mode: 'number' }).references(() => attachment.id),
    approvalStatus: varchar('approval_status', { length: 20 }).notNull(), // EXTRA_APPROVAL_STATUS
    approvedBy: bigint('approved_by', { mode: 'number' }).references(() => adminUser.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectReason: varchar('reject_reason', { length: 300 }),
    ...auditColumns,
    ...softDelete,
  },
  (t) => [index('extra_charge_work_idx').on(t.workOrderId), index('extra_charge_approval_idx').on(t.approvalStatus)],
);
