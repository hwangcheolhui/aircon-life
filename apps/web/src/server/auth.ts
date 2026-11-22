import 'server-only';
import { adminUser, branch, permission, role, rolePermission } from '@aircon/db';
import { type AdminPrincipal, type DataScope, type PermissionAction, type PermissionKey, hasPermission, permissionKey } from '@aircon/domain';
import { createAuthAdapter } from '@aircon/integrations';
import { and, eq, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from './db';

/** 요청 쿠키에 묶인 인증 어댑터 (서버 컴포넌트에서는 쿠키 쓰기가 무시된다) */
export async function getAuth() {
  const store = await cookies();
  return createAuthAdapter({
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (list) => {
      try {
        for (const c of list) store.set(c.name, c.value, c.options as Parameters<typeof store.set>[2]);
      } catch {
        // 서버 컴포넌트 렌더 중에는 쿠키를 쓸 수 없다. 세션 갱신은 middleware가 맡는다.
      }
    },
  });
}

export interface CurrentAdmin extends AdminPrincipal {
  name: string;
  loginId: string;
  roleName: string;
  branchName: string | null;
  permissions: ReadonlySet<PermissionKey>;
}

/** 현재 로그인 관리자 (요청당 1회 조회). 없거나 사용 불가 상태면 null */
export const getCurrentAdmin = cache(async (): Promise<CurrentAdmin | null> => {
  const authUserId = await (await getAuth()).getSessionUserId();
  if (!authUserId) return null;
  const db = getDb();
  const [row] = await db
    .select({ a: adminUser, r: role, branchName: branch.name })
    .from(adminUser)
    .innerJoin(role, eq(role.id, adminUser.roleId))
    .leftJoin(branch, eq(branch.id, adminUser.branchId))
    .where(and(eq(adminUser.authUserId, authUserId), isNull(adminUser.deletedAt), eq(adminUser.status, 'ACTIVE')));
  if (!row) return null;
  const perms = await db
    .select({ menuCode: permission.menuCode, action: permission.action })
    .from(rolePermission)
    .innerJoin(permission, eq(permission.id, rolePermission.permissionId))
    .where(eq(rolePermission.roleId, row.r.id));
  return {
    adminId: row.a.id,
    loginId: row.a.loginId,
    name: row.a.name,
    roleCode: row.r.roleCode,
    roleName: row.r.name,
    dataScope: row.r.dataScope as DataScope,
    branchId: row.a.branchId,
    branchName: row.branchName,
    permissions: new Set(perms.map((p) => permissionKey(p.menuCode, p.action as PermissionAction))),
  };
});

/** 관리자 페이지(서버 컴포넌트) 진입 가드: 비로그인 → 로그인 화면 */
export async function requireAdmin(): Promise<CurrentAdmin> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/admin/login');
  return admin;
}

/** 화면 진입 가드: READ 권한이 없으면 관리자 홈으로 */
export async function requireScreen(menuCode: string): Promise<CurrentAdmin> {
  const admin = await requireAdmin();
  if (!hasPermission(admin, menuCode, 'READ')) redirect('/admin?denied=' + encodeURIComponent(menuCode));
  return admin;
}

export class ForbiddenError extends Error {
  constructor(message = '권한이 없습니다.') {
    super(message);
  }
}

/**
 * 서버 액션 가드 (데이터 수정은 반드시 이 함수를 먼저 호출). 화면 권한(menu_code × action)을 서버에서 확인한다.
 */
export async function requirePermission(menuCode: string, action: PermissionAction): Promise<CurrentAdmin> {
  const admin = await getCurrentAdmin();
  if (!admin) throw new ForbiddenError('로그인이 필요합니다.');
  if (!hasPermission(admin, menuCode, action)) throw new ForbiddenError();
  return admin;
}
