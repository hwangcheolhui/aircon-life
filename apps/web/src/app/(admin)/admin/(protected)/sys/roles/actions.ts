'use server';
// A-SYS-020 역할·권한 (메뉴×행위 매트릭스, 데이터 범위) · F-ADM-SYS-02
import { rolePermissionUpdateInput, z } from '@aircon/contracts';
import { permission, role, rolePermission } from '@aircon/db';
import { permissionKey } from '@aircon/domain';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { UserError, handle, parse } from '@/server/action-result';
import { writeAudit } from '@/server/audit';
import { requirePermission } from '@/server/auth';
import { getDb } from '@/server/db';

const scopeInput = z.enum(['ALL', 'BRANCH', 'SELF']);

export async function saveRolePermissions(input: { roleId: number; dataScope: string; permissions: { menuCode: string; action: string }[] }) {
  return handle(async () => {
    const actor = await requirePermission('A-SYS-020', 'UPDATE');
    const data = parse(rolePermissionUpdateInput, input);
    const dataScope = parse(scopeInput, input.dataScope);
    const db = getDb();
    const [target] = await db.select().from(role).where(eq(role.id, data.roleId));
    if (!target) throw new UserError('역할을 찾을 수 없습니다.');
    const wanted = new Set(data.permissions.map((p) => permissionKey(p.menuCode, p.action)));
    if (target.roleCode === actor.roleCode && (!wanted.has('A-SYS-020:READ') || !wanted.has('A-SYS-020:UPDATE'))) {
      throw new UserError('본인 역할의 역할·권한 화면 권한은 뺄 수 없습니다.');
    }
    const all = await db.select().from(permission);
    const ids = all.filter((p) => wanted.has(permissionKey(p.menuCode, p.action as never))).map((p) => p.id);
    if (ids.length !== wanted.size) throw new UserError('정의되지 않은 메뉴·행위가 포함되어 있습니다.');
    const before = await db.select({ id: rolePermission.permissionId }).from(rolePermission).where(eq(rolePermission.roleId, target.id));
    const beforeIds = new Set(before.map((b) => b.id));
    const key = (id: number) => {
      const p = all.find((x) => x.id === id)!;
      return `${p.menuCode}:${p.action}`;
    };
    await db.transaction(async (tx) => {
      await tx.delete(rolePermission).where(eq(rolePermission.roleId, target.id));
      if (ids.length) await tx.insert(rolePermission).values(ids.map((permissionId) => ({ roleId: target.id, permissionId })));
      await tx.update(role).set({ dataScope }).where(eq(role.id, target.id));
    });
    await writeAudit({
      actorId: actor.adminId,
      action: 'PERMISSION_CHANGE',
      targetTable: 'role',
      targetId: target.id,
      detail: {
        roleCode: target.roleCode,
        dataScope: [target.dataScope, dataScope],
        added: ids.filter((i) => !beforeIds.has(i)).map(key),
        removed: [...beforeIds].filter((i) => !ids.includes(i)).map(key),
      },
    });
    revalidatePath('/admin', 'layout');
  });
}
