import 'server-only';
import { adminUser, branch, permission, role, rolePermission } from '@aircon/db';
import {
  type AdminPrincipal,
  type DataScope,
  type PermissionAction,
  type PermissionKey,
  PREVIEW_ROLE_CODE,
  hasPermission,
  permissionKey,
  previewPermissions,
} from '@aircon/domain';
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
  /** 임시 개발 모드(로그인 없이 읽기 전용 열람) 주체 여부 */
  preview: boolean;
}

/**
 * 임시 개발 모드: ADMIN_AUTH_BYPASS=true 이면 로그인 없이 관리자 화면을 읽기 전용으로 본다(구현 기간 한정, 02 §7).
 * 끄려면 환경변수를 지우거나 false 로 두고 다시 배포한다.
 */
export const isAdminAuthBypass = () => process.env.ADMIN_AUTH_BYPASS === 'true';

const PREVIEW_ADMIN: CurrentAdmin = {
  adminId: 0,
  loginId: 'preview',
  name: '임시 열람자',
  roleCode: PREVIEW_ROLE_CODE,
  roleName: '읽기 전용',
  dataScope: 'ALL',
  branchId: null,
  branchName: null,
  permissions: new Set(previewPermissions()),
  preview: true,
};

/** 현재 관리자 (요청당 1회 조회). 로그인 관리자가 우선이고, 없으면 임시 개발 모드일 때만 읽기 전용 열람자, 아니면 null */
export const getCurrentAdmin = cache(async (): Promise<CurrentAdmin | null> => {
  const admin = await getLoggedInAdmin();
  if (admin) return admin;
  return isAdminAuthBypass() ? PREVIEW_ADMIN : null;
});

/** 실제 로그인 관리자만 (임시 개발 모드 열람자 제외). 없거나 사용 불가 상태면 null */
const getLoggedInAdmin = async (): Promise<CurrentAdmin | null> => {
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
    preview: false,
  };
};

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
  // 임시 개발 모드 열람자는 조회만 한다. 등록·수정·삭제·다운로드는 로그인해야 한다.
  if (admin.preview && action !== 'READ') throw new ForbiddenError(PREVIEW_WRITE_DENIED);
  if (!hasPermission(admin, menuCode, action)) throw new ForbiddenError();
  return admin;
}

export const PREVIEW_WRITE_DENIED = '임시 개발 모드에서는 조회만 할 수 있습니다. 저장하려면 로그인해 주세요.';

/** 로그인한 실제 관리자 본인만 (비밀번호 변경 등). 임시 개발 모드 열람자는 로그인 화면으로 */
export async function requireLoggedInAdmin(): Promise<CurrentAdmin> {
  const admin = await getCurrentAdmin();
  if (!admin || admin.preview) redirect('/admin/login');
  return admin;
}
