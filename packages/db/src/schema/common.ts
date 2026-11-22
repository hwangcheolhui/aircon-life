import { bigint, timestamp } from 'drizzle-orm/pg-core';

/** ERD §0.3-2 공통컬럼. created_by/updated_by = 행위자 ID(관리자·기사·고객·시스템), FK 없음 */
export const auditColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: bigint('created_by', { mode: 'number' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: bigint('updated_by', { mode: 'number' }),
};

/** ERD §0.3-3 소프트 삭제 */
export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

export const idColumn = () => bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity();
