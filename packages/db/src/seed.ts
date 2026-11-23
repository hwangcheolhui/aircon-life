/**
 * 기준 데이터 시드 (04 단계 0 "공통 코드 시드(ERD §4)"). 여러 번 실행해도 안전하며 운영 중 수정한 값은 덮어쓰지 않는다.
 */
import {
  ADMIN_ROLE_CODES,
  SYSTEM_SETTING_SEEDS,
  allPermissionPairs,
  buildRolePermissions,
  permissionKey,
} from '@aircon/domain';
import { eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import { adminUser, commonCode, holiday, notificationTemplate, permission, role, rolePermission, systemSetting } from './schema';
import { COMMON_CODE_SEED, HOLIDAY_SEED, NOTIFICATION_TEMPLATE_SEED, ROLE_SEED } from './seed-data';

export interface SuperAdminSeed {
  loginId: string;
  email: string;
  name: string;
  /** 인증 계정을 만들고 auth_user_id 를 돌려준다 (Supabase Auth 또는 Mock) */
  createAuthUser: () => Promise<string>;
}

export async function seedBaseData(db: Db, superAdmin?: SuperAdminSeed) {
  await db.insert(commonCode).values(COMMON_CODE_SEED).onConflictDoNothing();
  await db.insert(role).values(ROLE_SEED).onConflictDoNothing();
  await db.insert(permission).values(allPermissionPairs()).onConflictDoNothing();
  await db
    .insert(systemSetting)
    .values(SYSTEM_SETTING_SEEDS.map((s) => ({ settingKey: s.key, settingValue: s.value, description: s.description })))
    .onConflictDoNothing();
  await db.insert(holiday).values(HOLIDAY_SEED).onConflictDoNothing();
  await db.insert(notificationTemplate).values(NOTIFICATION_TEMPLATE_SEED).onConflictDoNothing();

  // 역할별 권한: 아직 권한이 하나도 없는 역할에만 03 §4.4 매트릭스를 넣는다(관리자가 바꾼 권한 보존)
  const roles = await db.select().from(role);
  const perms = await db.select().from(permission);
  const permId = new Map(perms.map((p) => [permissionKey(p.menuCode, p.action as never), p.id]));
  const matrix = buildRolePermissions();
  for (const r of roles) {
    if (!(ADMIN_ROLE_CODES as readonly string[]).includes(r.roleCode)) continue;
    const [counted] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rolePermission)
      .where(eq(rolePermission.roleId, r.id));
    if ((counted?.count ?? 0) > 0) continue;
    const rows = [...matrix[r.roleCode as (typeof ADMIN_ROLE_CODES)[number]]]
      .map((k) => permId.get(k))
      .filter((id): id is number => id !== undefined)
      .map((permissionId) => ({ roleId: r.id, permissionId }));
    if (rows.length) await db.insert(rolePermission).values(rows);
  }

  if (superAdmin) {
    const existing = await db.select({ id: adminUser.id }).from(adminUser).where(eq(adminUser.loginId, superAdmin.loginId));
    if (existing.length === 0) {
      const superRole = roles.find((r) => r.roleCode === 'ADM_SUPER');
      if (!superRole) throw new Error('ADM_SUPER 역할이 없습니다.');
      const authUserId = await superAdmin.createAuthUser();
      await db.insert(adminUser).values({
        authUserId,
        loginId: superAdmin.loginId,
        name: superAdmin.name,
        email: superAdmin.email,
        roleId: superRole.id,
        branchId: null,
        status: 'ACTIVE',
      });
    }
  }
}
