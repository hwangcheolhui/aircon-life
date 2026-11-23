/**
 * D7 기사 (01_ERD §2.7.1~2.7.5) — 단계 2에서 근무표(work_schedule)·슬롯 자동 생성을 위해 technician 을 먼저 만들고,
 * 단계 4-1에서 숙련(technician_skill)·활동지역(technician_area)·등급 이력(technician_grade_history)을 더한다.
 * 관할 구역 지도(technician_zone)는 단계 4-2. profile_photo_id 의 FK는 attachment(단계 0) 를 참조한다.
 */
import { bigint, boolean, date, index, integer, numeric, pgTable, primaryKey, smallint, time, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { adminUser, branch } from './d1-org';
import { attachment } from './d13-system';
import { auditColumns, idColumn, softDelete } from './common';

/** 2.7.1 기사 */
export const technician = pgTable('technician', {
  id: idColumn(),
  techCode: varchar('tech_code', { length: 20 }).notNull().unique(),
  /** 기사 앱 로그인 ID = 휴대폰 번호의 검색용 해시(평문 번호를 두지 않음, 단계 4-1) */
  loginId: varchar('login_id', { length: 64 }).unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  /** 비밀번호 연속 실패 횟수 (TECH_LOGIN_MAX_FAIL 이상이면 비밀번호 로그인 잠금, 인증번호 로그인 시 0) */
  loginFailCount: integer('login_fail_count').notNull().default(0),
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

/** 2.7.2 기사 숙련 — 기기 유형별 작업 가능 수준 (BR-072) */
export const technicianSkill = pgTable(
  'technician_skill',
  {
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    deviceType: varchar('device_type', { length: 20 }).notNull(), // DEVICE_TYPE
    skillLevel: varchar('skill_level', { length: 20 }).notNull(), // SKILL_LEVEL
    certifiedAt: date('certified_at', { mode: 'string' }),
    certifiedBy: bigint('certified_by', { mode: 'number' }).references(() => adminUser.id),
    ...auditColumns,
  },
  (t) => [primaryKey({ columns: [t.technicianId, t.deviceType] })],
);

/**
 * 2.7.3 기사 활동지역(관할 법정동). 배정 보드의 "활동지역 외" 경고 기준(F-ADM-DSP-01).
 * zone_id 는 단계 4-2 technician_zone(지도 경계)이 생기면 FK를 건다(그 전에는 비어 있음).
 */
export const technicianArea = pgTable(
  'technician_area',
  {
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    zoneId: bigint('zone_id', { mode: 'number' }),
    legalDongCode: varchar('legal_dong_code', { length: 10 }).notNull(),
    priority: smallint('priority').notNull().default(1), // 1=주 관할, 2=보조 관할
    ...auditColumns,
  },
  (t) => [primaryKey({ columns: [t.technicianId, t.legalDongCode] }), index('technician_area_dong_idx').on(t.legalDongCode)],
);

/** 2.7.4 등급 변경 이력 (INSERT ONLY — DB 트리거로 UPDATE/DELETE 차단) */
export const technicianGradeHistory = pgTable(
  'technician_grade_history',
  {
    id: idColumn(),
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    fromGrade: varchar('from_grade', { length: 20 }),
    toGrade: varchar('to_grade', { length: 20 }).notNull(),
    reason: varchar('reason', { length: 200 }).notNull(),
    approvedBy: bigint('approved_by', { mode: 'number' }).references(() => adminUser.id),
    effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('technician_grade_history_tech_idx').on(t.technicianId, t.createdAt)],
);
