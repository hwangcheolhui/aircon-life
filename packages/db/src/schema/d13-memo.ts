/**
 * 2.13.2 메모 (ALP 나만의 캘린더 메모) — 단계 6은 미수금 독촉 메모([미수금], F-ADM-PAY-04 · T-PAY-010 미수 처리)만 쓴다.
 * 캘린더·지정 메모(memo_recipient)·팝업은 단계 10.
 */
import { bigint, boolean, date, index, pgTable, time, varchar } from 'drizzle-orm/pg-core';
import { serviceOrder } from './d5-order';
import { auditColumns, idColumn, softDelete } from './common';

export const memo = pgTable(
  'memo',
  {
    id: idColumn(),
    ownerType: varchar('owner_type', { length: 20 }).notNull(), // TECHNICIAN / ADMIN
    ownerId: bigint('owner_id', { mode: 'number' }).notNull(),
    headerCode: varchar('header_code', { length: 20 }), // MEMO_HEADER
    content: varchar('content', { length: 1000 }).notNull(),
    relatedOrderId: bigint('related_order_id', { mode: 'number' }).references(() => serviceOrder.id),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    isAllDay: boolean('is_all_day').notNull().default(true),
    repeatType: varchar('repeat_type', { length: 20 }).notNull().default('NONE'),
    isShared: boolean('is_shared').notNull().default(false),
    popupEnabled: boolean('popup_enabled').notNull().default(false),
    popupTime: time('popup_time'),
    prioritySource: varchar('priority_source', { length: 20 }),
    isDone: boolean('is_done').notNull().default(false),
    ...auditColumns,
    ...softDelete,
  },
  (t) => [index('memo_owner_idx').on(t.ownerType, t.ownerId, t.startDate), index('memo_order_idx').on(t.relatedOrderId)],
);
