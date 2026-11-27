/**
 * D8 배정 (01_ERD §2.8.2·2.8.3) — 단계 3 상담 콘솔에서 기사를 고르고 출장접수할 때(F-ADM-CSL-05·07) 처음 만든다.
 * 배정 보드·이관·자가 배정(단계 4-1·4-2)도 이 테이블을 쓴다.
 * 단계 4-2: 코스(route_plan·route_stop, §2.8.4·2.8.5)와 기사 위치(technician_location, §2.8.6).
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  decimal,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
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
    // 한 주문에 살아 있는 주기사 배정은 1건 (F-TEC-RTE-04 동시 담기: 먼저 확정된 쪽만 유효, 단계 4-2)
    uniqueIndex('assignment_active_main_uk')
      .on(t.orderId)
      .where(sql`role = 'MAIN' AND status IN ('REQUESTED', 'PROPOSED', 'ACCEPTED', 'TRANSFER_REQUESTED')`),
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

/** 2.8.4 기사 일자별 방문 코스 (기사 1명 × 일자 1개, 상태 01 §3.6) */
export const routePlan = pgTable(
  'route_plan',
  {
    id: idColumn(),
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    planDate: date('plan_date', { mode: 'string' }).notNull(),
    status: varchar('status', { length: 20 }).notNull(), // ROUTE_STATUS
    startPointType: varchar('start_point_type', { length: 20 }).notNull(), // ROUTE_POINT_TYPE
    startLat: numeric('start_lat', { precision: 10, scale: 7 }),
    startLng: numeric('start_lng', { precision: 10, scale: 7 }),
    endPointType: varchar('end_point_type', { length: 20 }),
    totalJobs: integer('total_jobs'),
    totalDistanceM: integer('total_distance_m'),
    totalTravelMin: integer('total_travel_min'),
    totalWorkMin: integer('total_work_min'),
    optimizeMethod: varchar('optimize_method', { length: 20 }), // MANUAL / AUTO
    optimizedAt: timestamp('optimized_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmDeadline: timestamp('confirm_deadline', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    // 단계 9 코스 변경 요청(F-ADM-DSP-09, BR-113): 마감 후 확정 코스를 바꾸려면 기사 요청 → 운영자 승인
    changeRequestStatus: varchar('change_request_status', { length: 20 }), // ROUTE_CHANGE_STATUS: REQUESTED/APPROVED/REJECTED
    changeRequestNote: varchar('change_request_note', { length: 300 }),
    changeRequestedAt: timestamp('change_requested_at', { withTimezone: true }),
    changeHandledBy: bigint('change_handled_by', { mode: 'number' }).references(() => adminUser.id),
    changeHandledAt: timestamp('change_handled_at', { withTimezone: true }),
    changeHandleNote: varchar('change_handle_note', { length: 300 }),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('route_plan_tech_date_uk').on(t.technicianId, t.planDate),
    index('route_plan_date_status_idx').on(t.planDate, t.status),
  ],
);

/** 2.8.5 코스의 방문 지점 */
export const routeStop = pgTable(
  'route_stop',
  {
    id: idColumn(),
    routePlanId: bigint('route_plan_id', { mode: 'number' })
      .notNull()
      .references(() => routePlan.id, { onDelete: 'cascade' }),
    stopSeq: smallint('stop_seq').notNull(),
    stopType: varchar('stop_type', { length: 20 }).notNull(), // STOP_TYPE
    assignmentId: bigint('assignment_id', { mode: 'number' }).references(() => assignment.id),
    orderId: bigint('order_id', { mode: 'number' }).references(() => serviceOrder.id),
    lat: numeric('lat', { precision: 10, scale: 7 }).notNull(),
    lng: numeric('lng', { precision: 10, scale: 7 }).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }),
    windowEnd: timestamp('window_end', { withTimezone: true }),
    plannedArrival: timestamp('planned_arrival', { withTimezone: true }),
    plannedDeparture: timestamp('planned_departure', { withTimezone: true }),
    /** 고객에게 마지막으로 안내한 방문 예정시각 (재확정 시 바뀐 고객에게만 변경 안내, 단계 4-2) */
    notifiedArrival: timestamp('notified_arrival', { withTimezone: true }),
    workMin: integer('work_min'),
    travelMinFromPrev: integer('travel_min_from_prev'),
    distanceMFromPrev: integer('distance_m_from_prev'),
    isLocked: boolean('is_locked').notNull().default(false),
    windowViolation: boolean('window_violation').notNull().default(false),
    eta: timestamp('eta', { withTimezone: true }),
    etaUpdatedAt: timestamp('eta_updated_at', { withTimezone: true }),
    actualArrival: timestamp('actual_arrival', { withTimezone: true }),
    actualDeparture: timestamp('actual_departure', { withTimezone: true }),
    status: varchar('status', { length: 20 }).notNull(), // STOP_STATUS
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('route_stop_plan_seq_uk').on(t.routePlanId, t.stopSeq),
    index('route_stop_order_idx').on(t.orderId),
  ],
);

/** 2.8.6 기사 위치 기록 — 위치정보 동의 후 근무 시작~종료에만 수집(BR-115), 원본은 LOCATION_RETENTION_DAYS 후 삭제(F-SYS-18) */
export const technicianLocation = pgTable(
  'technician_location',
  {
    id: idColumn(),
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    lat: numeric('lat', { precision: 10, scale: 7 }).notNull(),
    lng: numeric('lng', { precision: 10, scale: 7 }).notNull(),
    accuracyM: integer('accuracy_m'),
    speedKmh: decimal('speed_kmh', { precision: 5, scale: 1 }),
    routePlanId: bigint('route_plan_id', { mode: 'number' }).references(() => routePlan.id, {
      onDelete: 'set null',
    }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('technician_location_tech_time_idx').on(t.technicianId, t.recordedAt)],
);

/** F-SYS-18 일별 이동거리 집계 (위치 원본 삭제 후에도 보존, 단계 4-2) */
export const technicianDailyDistance = pgTable(
  'technician_daily_distance',
  {
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    workDate: date('work_date', { mode: 'string' }).notNull(),
    distanceM: integer('distance_m').notNull(),
    pointCount: integer('point_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('technician_daily_distance_uk').on(t.technicianId, t.workDate)],
);
