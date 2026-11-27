/**
 * 단계 10 기사 업무지원·교육 (04 §2 단계 10) — 01_ERD §2.7.6~2.7.8 · §2.9.6~2.9.7 · §2.13.2(memo_recipient) · §2.13.4~2.13.5.
 * - 교육: training_course(과정·기수) · training_enrollment(수강·수료) · technician_application(상시 모집 지원서)
 * - 자재: technician_material_stock(보유) · material_request(요청·불출)
 * - 콘텐츠: tech_document(기술자료·SOP) · quick_menu(퀵메뉴) · memo_recipient(지정 메모 수신자)
 */
import { bigint, boolean, date, index, integer, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { branch } from './d1-org';
import { material } from './d3-product';
import { serviceOrder } from './d5-order';
import { technician } from './d7-technician';
import { memo } from './d13-memo';
import { auditColumns, idColumn, softDelete } from './common';

/** 2.7.6 교육 과정(기수) */
export const trainingCourse = pgTable(
  'training_course',
  {
    id: idColumn(),
    courseCode: varchar('course_code', { length: 20 }).notNull().unique(),
    name: varchar('name', { length: 100 }).notNull(),
    courseType: varchar('course_type', { length: 20 }).notNull(), // COURSE_TYPE
    fee: integer('fee').notNull().default(0),
    totalHours: integer('total_hours'),
    passCriteria: varchar('pass_criteria', { length: 300 }),
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    capacity: integer('capacity'),
    status: varchar('status', { length: 20 }).notNull().default('RECRUITING'), // COURSE_STATUS (§3.21)
    ...auditColumns,
    ...softDelete,
  },
  (t) => [index('training_course_branch_idx').on(t.branchId, t.status)],
);

/** 2.7.7 수강 이력. 같은 과정에 같은 기사는 한 번 (UK) */
export const trainingEnrollment = pgTable(
  'training_enrollment',
  {
    id: idColumn(),
    courseId: bigint('course_id', { mode: 'number' })
      .notNull()
      .references(() => trainingCourse.id),
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    paidAmount: integer('paid_amount').notNull().default(0),
    attendanceRate: numeric('attendance_rate', { precision: 5, scale: 1, mode: 'number' }),
    practicalScore: integer('practical_score'),
    result: varchar('result', { length: 20 }).notNull().default('ENROLLED'), // ENROLLMENT_RESULT (§3.22)
    completedAt: date('completed_at', { mode: 'string' }),
    certificateNo: varchar('certificate_no', { length: 40 }).unique(),
    ...auditColumns,
  },
  (t) => [uniqueIndex('training_enrollment_uk').on(t.courseId, t.technicianId), index('training_enrollment_tech_idx').on(t.technicianId)],
);

/** 2.7.8 기사 지원서(상시 모집). 연락처 🔒 암호화 + 검색용 해시 */
export const technicianApplication = pgTable(
  'technician_application',
  {
    id: idColumn(),
    branchId: bigint('branch_id', { mode: 'number' })
      .notNull()
      .references(() => branch.id),
    name: varchar('name', { length: 30 }).notNull(),
    phone: varchar('phone', { length: 100 }).notNull(),
    phoneHash: varchar('phone_hash', { length: 64 }).notNull(),
    ageGroup: varchar('age_group', { length: 10 }), // AGE_GROUP
    region: varchar('region', { length: 50 }),
    experienceYears: integer('experience_years'),
    licenses: varchar('licenses', { length: 200 }),
    source: varchar('source', { length: 20 }).notNull(), // APPLICATION_SOURCE
    supportTargetFlag: boolean('support_target_flag').notNull().default(false),
    status: varchar('status', { length: 20 }).notNull().default('APPLIED'), // APPLICATION_STATUS (§3.20)
    note: varchar('note', { length: 500 }),
    technicianId: bigint('technician_id', { mode: 'number' }).references(() => technician.id),
    ...auditColumns,
    ...softDelete,
  },
  (t) => [index('technician_application_branch_idx').on(t.branchId, t.status), index('technician_application_phone_idx').on(t.phoneHash)],
);

/** 2.9.6 기사 보유 자재. PK(technician_id, material_id) */
export const technicianMaterialStock = pgTable(
  'technician_material_stock',
  {
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    materialId: bigint('material_id', { mode: 'number' })
      .notNull()
      .references(() => material.id),
    quantity: integer('quantity').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.technicianId, t.materialId] })],
);

/** 2.9.7 자재 요청·불출 */
export const materialRequest = pgTable(
  'material_request',
  {
    id: idColumn(),
    technicianId: bigint('technician_id', { mode: 'number' })
      .notNull()
      .references(() => technician.id),
    materialId: bigint('material_id', { mode: 'number' })
      .notNull()
      .references(() => material.id),
    quantity: integer('quantity').notNull(),
    neededDate: date('needed_date', { mode: 'string' }).notNull(),
    relatedOrderId: bigint('related_order_id', { mode: 'number' }).references(() => serviceOrder.id),
    status: varchar('status', { length: 20 }).notNull().default('REQUESTED'), // MATERIAL_REQUEST_STATUS (§3.19)
    handledBy: bigint('handled_by', { mode: 'number' }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [index('material_request_tech_idx').on(t.technicianId, t.status, t.neededDate)],
);

/** 2.13.4 기술자료·SOP·CS Tip·안전·서비스 핸드북 */
export const techDocument = pgTable(
  'tech_document',
  {
    id: idColumn(),
    docType: varchar('doc_type', { length: 20 }).notNull(), // TECH_DOC_TYPE
    deviceType: varchar('device_type', { length: 20 }), // DEVICE_TYPE (비우면 공통)
    title: varchar('title', { length: 200 }).notNull(),
    content: text('content').notNull(),
    fileIds: varchar('file_ids', { length: 200 }), // attachment.id 쉼표 구분 (ref_type=DOC)
    version: integer('version').notNull().default(1),
    isRequiredRead: boolean('is_required_read').notNull().default(false),
    ...auditColumns,
    ...softDelete,
  },
  (t) => [index('tech_document_type_idx').on(t.docType, t.deviceType)],
);

/** 2.13.5 퀵메뉴(즐겨찾기). menu_code = 화면 ID. UK(user_type, user_id, menu_code) */
export const quickMenu = pgTable(
  'quick_menu',
  {
    id: idColumn(),
    userType: varchar('user_type', { length: 20 }).notNull(), // TECHNICIAN / ADMIN
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    menuCode: varchar('menu_code', { length: 20 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    ...auditColumns,
  },
  (t) => [uniqueIndex('quick_menu_uk').on(t.userType, t.userId, t.menuCode)],
);

/** 2.13.2 지정 메모 수신자. PK(memo_id, receiver_type, receiver_id) */
export const memoRecipient = pgTable(
  'memo_recipient',
  {
    memoId: bigint('memo_id', { mode: 'number' })
      .notNull()
      .references(() => memo.id),
    receiverType: varchar('receiver_type', { length: 20 }).notNull(), // TECHNICIAN / ADMIN
    receiverId: bigint('receiver_id', { mode: 'number' }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.memoId, t.receiverType, t.receiverId] }), index('memo_recipient_receiver_idx').on(t.receiverType, t.receiverId)],
);
