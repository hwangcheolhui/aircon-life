// A-SYS-010 관리자 계정 (계정 CRUD, 잠금 해제) · F-ADM-SYS-01 — 목록은 마스킹(BR-100)
import { adminUser, branch, role } from '@aircon/db';
import { maskEmail, maskName, maskPhone } from '@aircon/domain';
import { asc, eq, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { decrypt } from '@/server/pii';
import { AccountsScreen } from './screen';

export default async function AccountsPage() {
  const admin = await requireScreen('A-SYS-010');
  const db = getDb();
  const [rows, roles, branches, codes] = await Promise.all([
    db
      .select({ a: adminUser, roleName: role.name, branchName: branch.name })
      .from(adminUser)
      .innerJoin(role, eq(role.id, adminUser.roleId))
      .leftJoin(branch, eq(branch.id, adminUser.branchId))
      .where(isNull(adminUser.deletedAt))
      .orderBy(asc(adminUser.loginId)),
    db.select().from(role).orderBy(asc(role.id)),
    db.select({ id: branch.id, name: branch.name }).from(branch).where(isNull(branch.deletedAt)).orderBy(asc(branch.name)),
    loadCodes(['ADMIN_STATUS']),
  ]);
  // 브라우저로는 마스킹된 값만 보낸다
  const masked = rows.map(({ a, roleName, branchName }) => ({
    id: a.id,
    loginId: a.loginId,
    name: maskName(a.name),
    phone: maskPhone(decrypt(a.phone)),
    email: maskEmail(a.email),
    roleId: a.roleId,
    roleName,
    branchName,
    status: a.status,
    lastLoginAt: a.lastLoginAt ? a.lastLoginAt.toISOString() : null,
    loginFailCount: a.loginFailCount,
  }));
  return (
    <AccountsScreen
      rows={masked}
      roles={roles.map((r) => ({ value: String(r.id), label: r.name }))}
      branches={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      codes={codes}
      selfId={admin.adminId}
      {...screenFlags(admin, 'A-SYS-010')}
    />
  );
}
