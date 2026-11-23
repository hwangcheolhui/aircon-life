/**
 * D7 기사 (01_ERD §2.7.1, §2.7.5) — 단계 2에서 근무표(work_schedule)·슬롯 자동 생성을 위해 technician 을 먼저 만든다.
 * 숙련·관할·등급 이력 등 나머지 D7 테이블은 단계 4-1에서 추가한다.
 * profile_photo_id 의 FK는 attachment(단계 0) 를 참조한다.
 */
import { bigint, boolean, date, integer, numeric, pgTable, time, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { branch } from './d1-org';
import { attachment } from './d13-system';
import { auditColumns, idColumn, softDelete } from './common';

/** 2.7.1 기사 */
export const technician = pgTable('technician', {
  id: idColumn(),
  techCode: varchar('tech_code', { length: 20 }).notNull().unique(),
  loginId: varchar('login_id', { length: 50 }).unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  name: varchar('name', { length: 30 }).notNull(),
  displayName: varchar('display_name', { length: 30 }),
  phone: varchar('phone', { length: 100 }).notNull(), // 🔒
  branchId: bigint('branch_id', { mode: 'number' })
    .notNull()
    .references(() => branch.id),
  grade: varchar('grade', { length: 20 }).notNull(), // TECH_GRADE
  contractType: varchar('contract_type', { length: 20 }).notNull(), // CONTRACT_TYPE
  bizRegNo: varchar('biz_reg_no', { length: 20 }),
  status: varchar('status', { length: 20 }).notNull(), // TECH_STATUS
  joinedAt: date('joined_at', { mode: 'string' }),
  leftAt: date('left_at', { mode: 'string' }),
  leaveReason: varchar('leave_reason', { length: 30 }),
  accompanyRequiredCount: integer('accompany_required_count').notNull().default(3),
  accompanyDoneCount: integer('accompany_done_count').notNull().default(0),
  licenses: varchar('licenses', { length: 200 }),
  bankCode: varchar('bank_code', { length: 10 }),
  bankAccount: varchar('bank_account', { length: 100 }), // 🔒
  accountHolder: varchar('account_holder', { length: 30 }),
  hasVehicle: boolean('has_vehicle'),
  vehicleNo: varchar('vehicle_no', { length: 20 }),
  insuranceJoined: boolean('insurance_joined'),
  ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
  vocCount: integer('voc_count').notNull().default(0),
  profilePhotoId: bigint('profile_photo_id', { mode: 'number' }).references(() => attachment.id),
  intro: varchar('intro', { length: 300 }),
  ...auditColumns,
  ...softDelete,
});

/** 2.7.5 기사 근무 일정 */
export const workSchedule = pgTable(
  'work_schedule',
  {
    id: idColumn(),
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    workDate: date('work_date', { mode: 'string' }).notNull(),
    scheduleType: varchar('schedule_type', { length: 20 }).notNull(), // SCHEDULE_TYPE
    startTime: time('start_time'),
    endTime: time('end_time'),
    maxJobs: integer('max_jobs'),
    note: varchar('note', { length: 200 }),
    ...auditColumns,
  },
  (t) => [uniqueIndex('work_schedule_tech_date_uk').on(t.technicianId, t.workDate)],
);
