/**
 * D11 정산 (01_ERD §2.11) — 단계 7: 수수료 정책·정산 회차·기사별 정산서·정산 상세·정산 상태 이력.
 * - 상태는 packages/domain settlement-rules 전이표(01 §3.3)를 거치고 settlement_status_history 에 1행 INSERT 한다.
 * - settlement_item·settlement_status_history 는 INSERT ONLY(DB 트리거). 확정(CONFIRMED·PAID)된 정산서는 금액을 바꿀 수 없고(BR-084),
 *   고칠 내용은 다음 회차 조정(ADJUST) 항목으로 넣는다.
 */
import { sql } from 'drizzle-orm';
import { bigint, date, index, integer, numeric, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { adminUser, branch } from './d1-org';
import { serviceOrder } from './d5-order';
import { technician } from './d7-technician';
import { workOrder } from './d9-work';
import { auditColumns, idColumn, softDelete } from './common';

/** 2.11.1 수수료(분배) 정책 */
export const commissionPolicy = pgTable('commission_policy', {
  id: idColumn(),
  policyName: varchar('policy_name', { length: 50 }).notNull(),
  techGrade: varchar('tech_grade', { length: 20 }), // TECH_GRADE (NULL=전체)
  contractType: varchar('contract_type', { length: 20 }), // CONTRACT_TYPE (NULL=전체)
  branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id), // NULL=전체
  calcType: varchar('calc_type', { length: 20 }).notNull(), // COMMISSION_CALC_TYPE
  techShareRate: numeric('tech_share_rate', { precision: 5, scale: 2 }),
  perUnitAmount: integer('per_unit_amount'),
  extraChargeShareRate: numeric('extra_charge_share_rate', { precision: 5, scale: 2 }),
  supportRoleRate: numeric('support_role_rate', { precision: 5, scale: 2 }),
  withholdingRate: numeric('withholding_rate', { precision: 5, scale: 2 }),
  validFrom: date('valid_from', { mode: 'string' }),
  validTo: date('valid_to', { mode: 'string' }),
  ...auditColumns,
  ...softDelete,
});

/** 2.11.2 정산 회차(주 단위) */
export const settlementBatch = pgTable(
  'settlement_batch',
  {
    id: idColumn(),
    batchNo: varchar('batch_no', { length: 30 }).notNull().unique(),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id), // NULL=전체
    status: varchar('status', { length: 20 }).notNull(), // SETTLEMENT_BATCH_STATUS (01 §3.3)
    scheduledPayDate: date('scheduled_pay_date', { mode: 'string' }),
    confirmedBy: bigint('confirmed_by', { mode: 'number' }).references(() => adminUser.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    totalPayAmount: integer('total_pay_amount').notNull().default(0),
    ...auditColumns,
  },
  (t) => [index('settlement_batch_period_idx').on(t.periodStart)],
);

/** 2.11.3 기사별 정산서 */
export const settlement = pgTable(
  'settlement',
  {
    id: idColumn(),
    batchId: bigint('batch_id', { mode: 'number' })
      .notNull()
      .references(() => settlementBatch.id),
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    jobCount: integer('job_count').notNull(),
    grossSales: integer('gross_sales').notNull(),
    basePay: integer('base_pay').notNull(),
    extraPay: integer('extra_pay').notNull().default(0),
    incentive: integer('incentive').notNull().default(0),
    deduction: integer('deduction').notNull().default(0),
    cashCollected: integer('cash_collected').notNull().default(0),
    taxableAmount: integer('taxable_amount').notNull(),
    withholdingTax: integer('withholding_tax').notNull().default(0),
    netPay: integer('net_pay').notNull(),
    status: varchar('status', { length: 20 }).notNull(), // SETTLEMENT_STATUS (01 §3.3)
    disputeNote: varchar('dispute_note', { length: 500 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    transferRef: varchar('transfer_ref', { length: 100 }),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('settlement_batch_tech_uk').on(t.batchId, t.technicianId),
    index('settlement_tech_idx').on(t.technicianId),
  ],
);

/** 2.11.4 정산 상세(작업 건별) — INSERT ONLY */
export const settlementItem = pgTable(
  'settlement_item',
  {
    id: idColumn(),
    settlementId: bigint('settlement_id', { mode: 'number' })
      .notNull()
      .references(() => settlement.id),
    workOrderId: bigint('work_order_id', { mode: 'number' }).references(() => workOrder.id),
    orderId: bigint('order_id', { mode: 'number' }).references(() => serviceOrder.id),
    role: varchar('role', { length: 20 }), // ASSIGN_ROLE (작업 항목만)
    salesAmount: integer('sales_amount').notNull().default(0),
    shareRate: numeric('share_rate', { precision: 5, scale: 2 }),
    payAmount: integer('pay_amount').notNull(),
    itemType: varchar('item_type', { length: 20 }).notNull(), // SETTLEMENT_ITEM_TYPE
    memo: varchar('memo', { length: 300 }),
    ...auditColumns,
  },
  (t) => [
    index('settlement_item_settlement_idx').on(t.settlementId),
    // 같은 작업이 같은 정산서에 같은 종류로 두 번 들어가지 않게 (조정 항목은 work_order_id 가 없어 제외)
    uniqueIndex('settlement_item_job_uk')
      .on(t.settlementId, t.workOrderId, t.itemType)
      .where(sql`work_order_id IS NOT NULL`),
    index('settlement_item_work_idx').on(t.workOrderId),
  ],
);

/** 정산 상태 이력 (01 §0.3-9, 단계 7 추가) — INSERT ONLY. settlement_id NULL = 회차 상태 변경 */
export const settlementStatusHistory = pgTable(
  'settlement_status_history',
  {
    id: idColumn(),
    batchId: bigint('batch_id', { mode: 'number' })
      .notNull()
      .references(() => settlementBatch.id),
    settlementId: bigint('settlement_id', { mode: 'number' }).references(() => settlement.id),
    fromStatus: varchar('from_status', { length: 20 }),
    toStatus: varchar('to_status', { length: 20 }).notNull(),
    actorType: varchar('actor_type', { length: 20 }).notNull(), // ACTOR_TYPE
    actorId: bigint('actor_id', { mode: 'number' }),
    memo: varchar('memo', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('settlement_status_history_batch_idx').on(t.batchId, t.createdAt)],
);
