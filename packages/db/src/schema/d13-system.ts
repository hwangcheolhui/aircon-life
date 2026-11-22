/** D13 시스템 (01_ERD §2.13.6~8) */
import { bigint, integer, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { idColumn } from './common';

/** 2.13.6 첨부파일 */
export const attachment = pgTable('attachment', {
  id: idColumn(),
  storageKey: varchar('storage_key', { length: 300 }).notNull(),
  originalName: varchar('original_name', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  refType: varchar('ref_type', { length: 20 }).notNull(), // ATTACHMENT_REF_TYPE
  refId: bigint('ref_id', { mode: 'number' }),
  uploadedByType: varchar('uploaded_by_type', { length: 20 }).notNull(),
  uploadedById: bigint('uploaded_by_id', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/** 2.13.7 감사 로그 (INSERT ONLY — DB 트리거로 UPDATE/DELETE 차단) */
export const auditLog = pgTable('audit_log', {
  id: idColumn(),
  actorType: varchar('actor_type', { length: 20 }).notNull(),
  actorId: bigint('actor_id', { mode: 'number' }),
  action: varchar('action', { length: 30 }).notNull(), // AUDIT_ACTION
  targetTable: varchar('target_table', { length: 50 }),
  targetId: varchar('target_id', { length: 50 }),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  detailJson: jsonb('detail_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 2.13.8 시스템 설정(키-값) */
export const systemSetting = pgTable('system_setting', {
  settingKey: varchar('setting_key', { length: 50 }).primaryKey(),
  settingValue: varchar('setting_value', { length: 500 }).notNull(),
  description: varchar('description', { length: 200 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: bigint('updated_by', { mode: 'number' }),
});
