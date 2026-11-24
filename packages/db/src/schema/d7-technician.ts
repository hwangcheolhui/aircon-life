/**
 * D7 기사 (01_ERD §2.7.1~2.7.5) — 단계 2에서 근무표(work_schedule)·슬롯 자동 생성을 위해 technician 을 먼저 만들고,
 * 단계 4-1에서 숙련(technician_skill)·활동지역(technician_area)·등급 이력(technician_grade_history)을 더한다.
 * 단계 4-2에서 관할 구역 지도(technician_zone)와 위치정보 동의·근무 시작 시각(technician.location_agreed_at·duty_started_at)을 더한다.
 * profile_photo_id 의 FK는 attachment(단계 0) 를 참조한다.
 */
import { bigint, boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, smallint, time, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
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
  /** 위치정보 수집 동의 시각 (최초 1회, BR-115·F-TEC-AUTH-02, 단계 4-2) */
  locationAgreedAt: timestamp('location_agreed_at', { withTimezone: true }),
  /** 지금 근무 중이면 근무 시작 시각, 근무 종료면 NULL (위치 수집 구간, 단계 4-2) */
  dutyStartedAt: timestamp('duty_started_at', { withTimezone: true }),
  ...auditColumns,
  ...softDelete,
});

/** 2.7.3-1 기사 관할 구역 (지도 경계, 단계 4-2 A-DSP-060) */
export const technicianZone = pgTable(
  'technician_zone',
  {
    id: idColumn(),
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    zoneName: varchar('zone_name', { length: 50 }).notNull(),
    zoneType: varchar('zone_type', { length: 20 }).notNull(), // ZONE_TYPE
    defineMethod: varchar('define_method', { length: 20 }).notNull(), // ZONE_DEFINE_METHOD
    boundaryGeojson: jsonb('boundary_geojson'),
    /** 구역에 든 법정동 코드 (DONG_SET=고른 동, DRAWN=저장 시 다각형 안에 중심이 든 거점 법정동). technician_area 의 원천(단계 4-2) */
    dongCodes: jsonb('dong_codes').$type<string[]>().notNull().default([]),
    centerLat: numeric('center_lat', { precision: 10, scale: 7 }),
    centerLng: numeric('center_lng', { precision: 10, scale: 7 }),
    /** 지도 팔레트 번호 1~6 (tokens.css --map-zone-N) */
    color: varchar('color', { length: 10 }),
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
    ...auditColumns,
    ...softDelete,
  },
  (t) => [index('technician_zone_tech_idx').on(t.technicianId), index('technician_zone_branch_idx').on(t.branchId)],
);

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
 * zone_id 가 있으면 관할 구역(A-DSP-060)에서 만든 행, 없으면 기사 상세(A-TEC-020)에서 직접 고른 행이다(단계 4-2).
 */
export const technicianArea = pgTable(
  'technician_area',
  {
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    zoneId: bigint('zone_id', { mode: 'number' }).references(() => technicianZone.id),
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
