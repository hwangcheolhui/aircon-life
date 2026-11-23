/**
 * D8 배정 (01_ERD §2.8.2·2.8.3) — 단계 3 상담 콘솔에서 기사를 고르고 출장접수할 때(F-ADM-CSL-05·07) 처음 만든다.
 * 배정 보드·이관·자가 배정(단계 4-1·4-2)도 이 테이블을 쓴다.
 */
import { bigint, boolean, index, pgTable, smallint, timestamp, varchar } from 'drizzle-orm/pg-core';
import { adminUser } from './d1-org';
import { serviceOrder, timeSlot } from './d5-order';
import { technician } from './d7-technician';
import { auditColumns, idColumn } from './common';

/** 2.8.2 기사 배정. technician_id NULL = 미지정(긴급) 대기 */
export const assignment = pgTable(
  'assignment',
  {
    id: idColumn(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => serviceOrder.id),
    technicianId: bigint('technician_id', { mode: 'number' }).references(() => technician.id),
    role: varchar('role', { length: 20 }).notNull(), // ASSIGN_ROLE
    timeSlotId: bigint('time_slot_id', { mode: 'number' }).references(() => timeSlot.id),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
    scheduledEnd: timestamp('scheduled_end', { withTimezone: true }),
    assignMethod: varchar('assign_method', { length: 20 }).notNull(), // ASSIGN_METHOD
    status: varchar('status', { length: 20 }).notNull(), // ASSIGN_STATUS
    routeOrder: smallint('route_order'),
    inZone: boolean('in_zone'),
    rejectReason: varchar('reject_reason', { length: 200 }),
    assignedBy: bigint('assigned_by', { mode: 'number' }).references(() => adminUser.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    index('assignment_order_idx').on(t.orderId),
    index('assignment_tech_start_idx').on(t.technicianId, t.scheduledStart),
  ],
);

/** 2.8.3 배정·이관 이력 (INSERT ONLY — DB 트리거로 UPDATE/DELETE 차단) */
export const assignmentHistory = pgTable(
  'assignment_history',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => serviceOrder.id),
    fromTechnicianId: bigint('from_technician_id', { mode: 'number' }).references(() => technician.id),
    toTechnicianId: bigint('to_technician_id', { mode: 'number' }).references(() => technician.id),
    action: varchar('action', { length: 20 }).notNull(), // ASSIGN_ACTION
    reason: varchar('reason', { length: 200 }),
    actorType: varchar('actor_type', { length: 20 }).notNull(), // ACTOR_TYPE
    actorId: bigint('actor_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('assignment_history_order_idx').on(t.orderId, t.createdAt)],
);
