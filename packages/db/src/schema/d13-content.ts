/** D13 콘텐츠 (01_ERD §2.13.1·2.13.3) — 단계 8-2 공지(A-CNT-010, T-NTC-010)·FAQ(A-CNT-020, C-CS-010) */
import { bigint, boolean, index, integer, pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { adminUser, branch } from './d1-org';
import { consultation } from './d6-consult';
import { auditColumns, idColumn, softDelete } from './common';

/** 2.13.1 공지 (ALP 전체/안전/거점 공지 + 고객 공지) */
export const notice = pgTable(
  'notice',
  {
    id: idColumn(),
    noticeType: varchar('notice_type', { length: 20 }).notNull(), // NOTICE_TYPE
    targetAudience: varchar('target_audience', { length: 20 }).notNull(), // NOTICE_AUDIENCE
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
    title: varchar('title', { length: 200 }).notNull(),
    content: text('content').notNull(),
    isPinned: boolean('is_pinned').notNull().default(false),
    isPopup: boolean('is_popup').notNull().default(false),
    publishFrom: timestamp('publish_from', { withTimezone: true }),
    publishTo: timestamp('publish_to', { withTimezone: true }),
    authorAdminId: bigint('author_admin_id', { mode: 'number' }).references(() => adminUser.id),
    ...auditColumns,
    ...softDelete,
  },
  (t) => [index('notice_publish_idx').on(t.publishFrom)],
);

/** 공지 읽음(필독 확인). PK(notice_id, reader_type, reader_id) */
export const noticeRead = pgTable(
  'notice_read',
  {
    noticeId: bigint('notice_id', { mode: 'number' })
      .notNull()
      .references(() => notice.id),
    readerType: varchar('reader_type', { length: 20 }).notNull(), // TECHNICIAN / ADMIN
    readerId: bigint('reader_id', { mode: 'number' }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.noticeId, t.readerType, t.readerId] })],
);

/** 2.13.3 FAQ */
export const faq = pgTable(
  'faq',
  {
    id: idColumn(),
    category: varchar('category', { length: 30 }).notNull(), // FAQ_CATEGORY
    audience: varchar('audience', { length: 20 }).notNull(), // FAQ_AUDIENCE
    question: varchar('question', { length: 300 }).notNull(),
    answer: text('answer').notNull(),
    sourceConsultationId: bigint('source_consultation_id', { mode: 'number' }).references(() => consultation.id),
    viewCount: integer('view_count').notNull().default(0),
    isPublished: boolean('is_published').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...auditColumns,
    ...softDelete,
  },
  (t) => [index('faq_audience_idx').on(t.audience, t.isPublished, t.sortOrder)],
);
