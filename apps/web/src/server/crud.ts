import 'server-only';
/**
 * 관리자 기준 데이터 등록·수정·삭제 공통 처리.
 * 순서: 서버 권한 확인(requirePermission) → 입력 검증(Zod) → 추가 검사(거점 범위 등) → 저장 → 화면 갱신.
 */
import type { z } from '@aircon/contracts';
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { revalidatePath } from 'next/cache';
import { type ActionResult, handle, parse } from './action-result';
import { type CurrentAdmin, requirePermission } from './auth';
import { getDb } from './db';

interface CrudConfig<S extends z.ZodTypeAny> {
  menu: string;
  table: PgTable;
  idColumn: PgColumn;
  schema: S;
  /** 숫자 PK면 true (기본), 문자열 PK(holiday·system_setting)면 false */
  numericId?: boolean;
  hasAudit?: boolean;
  softDelete?: boolean;
  /** 저장 직전 검사·값 보정 (예: BR-102 거점 범위) */
  check?: (data: z.output<S>, admin: CurrentAdmin, id: string | null) => Promise<void> | void;
  /** 삭제 직전 검사 */
  checkDelete?: (id: string, admin: CurrentAdmin) => Promise<void> | void;
  path: string;
}

const toId = (id: string, numeric = true) => (numeric ? Number(id) : id);

export async function saveRow<S extends z.ZodTypeAny>(
  cfg: CrudConfig<S>,
  values: Record<string, string>,
  id: string | null,
): Promise<ActionResult> {
  return handle(async () => {
    const admin = await requirePermission(cfg.menu, id ? 'UPDATE' : 'CREATE');
    const data = parse(cfg.schema, values) as Record<string, unknown>;
    await cfg.check?.(data as z.output<S>, admin, id);
    const db = getDb();
    const now = new Date();
    const stamp = cfg.hasAudit === false ? {} : id ? { updatedAt: now, updatedBy: admin.adminId } : { createdBy: admin.adminId, updatedBy: admin.adminId };
    if (id) {
      await db
        .update(cfg.table)
        .set({ ...data, ...stamp } as never)
        .where(eq(cfg.idColumn, toId(id, cfg.numericId)));
    } else {
      await db.insert(cfg.table).values({ ...data, ...stamp } as never);
    }
    revalidatePath(cfg.path);
  });
}

export async function deleteRow<S extends z.ZodTypeAny>(cfg: CrudConfig<S>, id: string): Promise<ActionResult> {
  return handle(async () => {
    const admin = await requirePermission(cfg.menu, 'DELETE');
    await cfg.checkDelete?.(id, admin);
    const db = getDb();
    if (cfg.softDelete) {
      await db
        .update(cfg.table)
        .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: admin.adminId } as never)
        .where(eq(cfg.idColumn, toId(id, cfg.numericId)));
    } else {
      await db.delete(cfg.table).where(eq(cfg.idColumn, toId(id, cfg.numericId)));
    }
    revalidatePath(cfg.path);
  });
}

/** 화면 권한 플래그 (버튼 노출용 — 실제 차단은 서버 액션에서 다시 확인) */
export function screenFlags(admin: CurrentAdmin, menu: string) {
  const has = (a: 'CREATE' | 'UPDATE' | 'DELETE') => admin.permissions.has(`${menu}:${a}`);
  return { canCreate: has('CREATE'), canUpdate: has('UPDATE'), canDelete: has('DELETE') };
}
