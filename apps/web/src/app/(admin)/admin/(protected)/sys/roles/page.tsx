// A-SYS-020 역할·권한 (메뉴×행위 매트릭스) · F-ADM-SYS-02
import { permission, role, rolePermission } from '@aircon/db';
import { ADMIN_MENU, PERMISSION_ACTIONS } from '@aircon/domain';
import { asc, eq } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { getDb } from '@/server/db';
import { RolesScreen } from './screen';

export default async function RolesPage() {
  const admin = await requireScreen('A-SYS-020');
  const db = getDb();
  const [roles, grants, codes] = await Promise.all([
    db.select().from(role).orderBy(asc(role.id)),
    db
      .select({ roleId: rolePermission.roleId, menuCode: permission.menuCode, action: permission.action })
      .from(rolePermission)
      .innerJoin(permission, eq(permission.id, rolePermission.permissionId)),
    loadCodes(['PERMISSION_ACTION', 'DATA_SCOPE']),
  ]);
  const byRole: Record<number, string[]> = {};
  for (const g of grants) (byRole[g.roleId] ??= []).push(`${g.menuCode}:${g.action}`);
  return (
    <RolesScreen
      roles={roles}
      grants={byRole}
      menu={ADMIN_MENU.map((g) => ({ name: g.name, screens: g.screens.map((s) => ({ id: s.screenId, name: s.name, stage: s.stage })) }))}
      actions={PERMISSION_ACTIONS.map((a) => ({ value: a, label: codes.PERMISSION_ACTION!.find((c) => c.value === a)?.label ?? a }))}
      scopes={codes.DATA_SCOPE ?? []}
      canUpdate={admin.permissions.has('A-SYS-020:UPDATE')}
    />
  );
}
