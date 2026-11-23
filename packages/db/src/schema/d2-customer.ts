/** D2 고객 (01_ERD §2.2) — 단계 2. 🔒 컬럼은 AES-256-GCM 암호문, 검색은 *_hash 로만(ERD §6). */
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { adminUser, branch } from './d1-org';
import { auditColumns, idColumn, softDelete } from './common';
import { callLog } from './d6-consult';

/** 2.2.1 고객. corporate_account_id 의 FK는 corporate_account 테이블이 생기는 단계(11)에서 건다. */
export const customer = pgTable(
  'customer',
  {
    id: idColumn(),
    customerNo: varchar('customer_no', { length: 20 }).notNull().unique(),
    customerType: varchar('customer_type', { length: 20 }).notNull(), // CUSTOMER_TYPE
    name: varchar('name', { length: 100 }).notNull(), // 🔒
    phone1: varchar('phone1', { length: 100 }).notNull(), // 🔒
    phone1Hash: char('phone1_hash', { length: 64 }),
    phone2: varchar('phone2', { length: 100 }), // 🔒
    emergencyPhone: varchar('emergency_phone', { length: 100 }), // 🔒
    email: varchar('email', { length: 100 }),
    joinChannel: varchar('join_channel', { length: 20 }).notNull(), // JOIN_CHANNEL
    authProvider: varchar('auth_provider', { length: 20 }), // AUTH_PROVIDER
    authProviderKey: varchar('auth_provider_key', { length: 100 }),
    grade: varchar('grade', { length: 20 }).notNull().default('NORMAL'), // CUSTOMER_GRADE
    corporateAccountId: bigint('corporate_account_id', { mode: 'number' }),
    privacyAgreeStatus: varchar('privacy_agree_status', { length: 20 }).notNull(), // PRIVACY_AGREE_STATUS
    marketingAgree: boolean('marketing_agree').notNull().default(false),
    happycallReject: boolean('happycall_reject').notNull().default(false),
    referralCode: varchar('referral_code', { length: 10 }).unique(),
    referredByCustomerId: bigint('referred_by_customer_id', { mode: 'number' }).references((): AnyPgColumn => customer.id),
    lastServiceDate: date('last_service_date', { mode: 'string' }),
    totalOrderCount: integer('total_order_count').notNull().default(0),
    memo: text('memo'),
    status: varchar('status', { length: 20 }).notNull(), // CUSTOMER_STATUS
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    purgeDueDate: date('purge_due_date', { mode: 'string' }),
    ...auditColumns,
    ...softDelete,
  },
  (t) => [
    index('customer_phone1_hash_idx').on(t.phone1Hash),
    index('customer_auth_provider_idx').on(t.authProvider, t.authProviderKey),
  ],
);

/** 2.2.2 고객 주소 (복수 보유) */
export const customerAddress = pgTable(
  'customer_address',
  {
    id: idColumn(),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customer.id),
    alias: varchar('alias', { length: 30 }),
    zipcode: varchar('zipcode', { length: 10 }).notNull(),
    roadAddress: varchar('road_address', { length: 200 }).notNull(),
    jibunAddress: varchar('jibun_address', { length: 200 }),
    detailAddress: varchar('detail_address', { length: 200 }), // 🔒
    legalDongCode: varchar('legal_dong_code', { length: 10 }),
    lat: numeric('lat', { precision: 10, scale: 7 }),
    lng: numeric('lng', { precision: 10, scale: 7 }),
    housingType: varchar('housing_type', { length: 20 }), // HOUSING_TYPE
    buildingAgeGroup: varchar('building_age_group', { length: 20 }),
    hasElevator: boolean('has_elevator'),
    parkingNote: varchar('parking_note', { length: 200 }),
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    isDefault: boolean('is_default').notNull().default(false),
    ...auditColumns,
    ...softDelete,
  },
  (t) => [index('customer_address_customer_idx').on(t.customerId)],
);

/** 2.2.4 동의 이력 (INSERT ONLY — DB 트리거로 UPDATE/DELETE 차단). 상담원 구두 동의는 근거 통화(call_log_id)를 남긴다(단계 3). */
export const consentHistory = pgTable(
  'consent_history',
  {
    id: idColumn(),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customer.id),
    consentType: varchar('consent_type', { length: 30 }).notNull(), // CONSENT_TYPE
    action: varchar('action', { length: 20 }).notNull(), // CONSENT_ACTION
    channel: varchar('channel', { length: 20 }).notNull(), // CONSENT_CHANNEL
    termsVersion: varchar('terms_version', { length: 20 }),
    agentAdminId: bigint('agent_admin_id', { mode: 'number' }).references(() => adminUser.id),
    callLogId: bigint('call_log_id', { mode: 'number' }).references((): AnyPgColumn => callLog.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('consent_history_customer_idx').on(t.customerId, t.createdAt)],
);

/** 2.2.6 고객 태그 (다빈도·주의·이사예정 등, F-ADM-CUS-03). PK(customer_id, tag_code) */
export const customerTag = pgTable(
  'customer_tag',
  {
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customer.id),
    tagCode: varchar('tag_code', { length: 30 }).notNull(), // CUSTOMER_TAG
    note: varchar('note', { length: 200 }),
    ...auditColumns,
  },
  (t) => [primaryKey({ columns: [t.customerId, t.tagCode] })],
);
