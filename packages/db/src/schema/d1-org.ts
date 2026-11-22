/** D1 조직·권한·공통 (01_ERD §2.1) */
import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { auditColumns, idColumn, softDelete } from './common';

/** 2.1.1 거점 */
export const branch = pgTable('branch', {
  id: idColumn(),
  branchCode: varchar('branch_code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 50 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(), // BRANCH_STATUS
  address: varchar('address', { length: 200 }),
  centerLat: numeric('center_lat', { precision: 10, scale: 7 }),
  centerLng: numeric('center_lng', { precision: 10, scale: 7 }),
  radiusKm: numeric('radius_km', { precision: 4, scale: 1 }),
  phone: varchar('phone', { length: 20 }),
  managerAdminId: bigint('manager_admin_id', { mode: 'number' }).references((): AnyPgColumn => adminUser.id),
  openTime: time('open_time'),
  closeTime: time('close_time'),
  openedAt: date('opened_at', { mode: 'string' }),
  ...auditColumns,
  ...softDelete,
});

/** 2.1.2 거점 관할 지역 */
export const serviceArea = pgTable('service_area', {
  id: idColumn(),
  branchId: bigint('branch_id', { mode: 'number' })
    .notNull()
    .references(() => branch.id),
  sido: varchar('sido', { length: 30 }).notNull(),
  sigungu: varchar('sigungu', { length: 30 }).notNull(),
  eupmyeondong: varchar('eupmyeondong', { length: 30 }).notNull(),
  legalDongCode: varchar('legal_dong_code', { length: 10 }).unique(),
  isServiceable: boolean('is_serviceable').notNull().default(true),
  travelFee: integer('travel_fee').notNull().default(0),
  ...auditColumns,
});

/** 2.1.4 역할 */
export const role = pgTable('role', {
  id: idColumn(),
  roleCode: varchar('role_code', { length: 30 }).notNull().unique(),
  name: varchar('name', { length: 50 }).notNull(),
  dataScope: varchar('data_scope', { length: 20 }).notNull(), // DATA_SCOPE
});

/** 2.1.3 관리자 계정. 비밀번호는 Supabase Auth(auth.users)에 있고 auth_user_id로 연결한다. */
export const adminUser = pgTable('admin_user', {
  id: idColumn(),
  authUserId: uuid('auth_user_id').unique(),
  loginId: varchar('login_id', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 30 }).notNull(),
  phone: varchar('phone', { length: 100 }), // 🔒 AES-256-GCM 암호문
  email: varchar('email', { length: 100 }).notNull().unique(),
  roleId: bigint('role_id', { mode: 'number' })
    .notNull()
    .references(() => role.id),
  branchId: bigint('branch_id', { mode: 'number' }).references((): AnyPgColumn => branch.id),
  status: varchar('status', { length: 20 }).notNull(), // ADMIN_STATUS
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  loginFailCount: integer('login_fail_count').notNull().default(0),
  ...auditColumns,
  ...softDelete,
});

/** 2.1.5 권한 (menu_code = 03_IA 화면 ID) */
export const permission = pgTable(
  'permission',
  {
    id: idColumn(),
    menuCode: varchar('menu_code', { length: 50 }).notNull(),
    action: varchar('action', { length: 20 }).notNull(), // PERMISSION_ACTION
  },
  (t) => [uniqueIndex('permission_menu_action_uk').on(t.menuCode, t.action)],
);

/** 2.1.6 역할-권한 */
export const rolePermission = pgTable(
  'role_permission',
  {
    roleId: bigint('role_id', { mode: 'number' })
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    permissionId: bigint('permission_id', { mode: 'number' })
      .notNull()
      .references(() => permission.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

/** 2.1.7 공통 코드 */
export const commonCode = pgTable(
  'common_code',
  {
    id: idColumn(),
    groupCode: varchar('group_code', { length: 50 }).notNull(),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    extraJson: jsonb('extra_json'),
  },
  (t) => [uniqueIndex('common_code_group_code_uk').on(t.groupCode, t.code)],
);

/** 2.1.8 공휴일 */
export const holiday = pgTable('holiday', {
  holidayDate: date('holiday_date', { mode: 'string' }).primaryKey(),
  name: varchar('name', { length: 50 }).notNull(),
  isSurcharge: boolean('is_surcharge').notNull().default(true),
});

