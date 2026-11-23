/** D2 서비스 지역 오픈 알림 신청 (01_ERD §2.2.7, §3.9) — 단계 1 보강. F-CUS-QUO-08 · F-ADM-DSP-11 · F-SYS-19 */
import { sql } from 'drizzle-orm';
import { bigint, char, index, integer, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { branch } from './d1-org';
import { auditColumns, idColumn } from './common';

/**
 * 2.2.7 오픈 알림 신청. 회원 가입 전이라 customer 와 연결하지 않는다.
 * phone 은 앱 레벨 암호문(🔒), NOTIFIED·EXPIRED 가 되면 phone·phone_hash 를 NULL 로 지운다(BR-003).
 */
export const areaOpenRequest = pgTable(
  'area_open_request',
  {
    id: idColumn(),
    legalDongCode: varchar('legal_dong_code', { length: 10 }).notNull(),
    sido: varchar('sido', { length: 30 }).notNull(),
    sigungu: varchar('sigungu', { length: 30 }).notNull(),
    eupmyeondong: varchar('eupmyeondong', { length: 30 }).notNull(),
    phone: varchar('phone', { length: 100 }),
    phoneHash: char('phone_hash', { length: 64 }),
    privacyAgreedAt: timestamp('privacy_agreed_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 20 }).notNull(), // AREA_OPEN_STATUS (01 §3.9)
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    notifyChannel: varchar('notify_channel', { length: 20 }), // ALIMTALK / SMS
    notifyFailCount: integer('notify_fail_count').notNull().default(0),
    lastFailReason: varchar('last_fail_reason', { length: 200 }),
    ...auditColumns,
  },
  (t) => [
    index('area_open_request_dong_status_idx').on(t.legalDongCode, t.status),
    uniqueIndex('area_open_request_waiting_uk')
      .on(t.legalDongCode, t.phoneHash)
      .where(sql`status = 'WAITING'`),
  ],
);
