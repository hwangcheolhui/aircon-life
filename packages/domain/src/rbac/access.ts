/**
 * RBAC 판정 (F-ADM-SYS-02) + 거점 데이터 범위 (BR-102).
 */
import {
  ADMIN_MENU,
  type AdminMenuGroup,
  type ImplementationStage,
  RELEASED_STAGES,
  isScreenReleased,
} from './admin-menus';
import { type PermissionAction, type PermissionKey, permissionKey } from './permission-matrix';

export type DataScope = 'ALL' | 'BRANCH' | 'SELF';

export interface AdminPrincipal {
  adminId: number;
  roleCode: string;
  /** role.data_scope */
  dataScope: DataScope;
  /** admin_user.branch_id (NULL = 본사 전체) */
  branchId: number | null;
  permissions: ReadonlySet<PermissionKey> | readonly PermissionKey[];
}

function permSet(p: AdminPrincipal): ReadonlySet<PermissionKey> {
  return p.permissions instanceof Set ? p.permissions : new Set(p.permissions as readonly PermissionKey[]);
}

export function hasPermission(p: AdminPrincipal, menuCode: string, action: PermissionAction): boolean {
  return permSet(p).has(permissionKey(menuCode, action));
}

/** 역할별 GNB/LNB: READ 권한이 있고 구현이 끝난 화면만 남긴다(03 §0.2-4 권한에 따라 메뉴 자체를 숨김). */
export function visibleAdminMenu(
  p: AdminPrincipal,
  released: readonly ImplementationStage[] = RELEASED_STAGES,
): AdminMenuGroup[] {
  return ADMIN_MENU.map((g) => ({
    ...g,
    screens: g.screens.filter(
      (s) => s.inMenu !== false && isScreenReleased(s, released) && hasPermission(p, s.screenId, 'READ'),
    ),
  })).filter((g) => g.screens.length > 0);
}

export type BranchFilter = { kind: 'ALL' } | { kind: 'BRANCH'; branchId: number } | { kind: 'NONE' };

/**
 * BR-102 실효 데이터 범위.
 * - 역할 범위가 ALL이고 소속 거점이 없으면(본사) 전체.
 * - 역할 범위가 BRANCH·SELF이거나 거점 소속 관리자면 자기 거점으로 고정.
 * - 거점 범위인데 소속 거점이 없으면 아무 데이터도 보지 않는다.
 */
export function effectiveScope(p: AdminPrincipal): BranchFilter {
  if (p.dataScope === 'ALL' && p.branchId === null) return { kind: 'ALL' };
  if (p.branchId === null) return { kind: 'NONE' };
  return { kind: 'BRANCH', branchId: p.branchId };
}

/**
 * 조회 시 거점 필터 결정 (상단 "거점 선택", 03 §4.1).
 * 전체 범위 사용자는 선택한 거점(없으면 전체), 거점 범위 사용자는 선택과 관계없이 자기 거점.
 */
export function resolveBranchFilter(p: AdminPrincipal, requestedBranchId?: number | null): BranchFilter {
  const scope = effectiveScope(p);
  if (scope.kind === 'ALL') {
    return requestedBranchId ? { kind: 'BRANCH', branchId: requestedBranchId } : scope;
  }
  return scope;
}

/** 특정 거점 데이터에 접근(등록·수정) 가능한지. branchId=null(전 거점 공통 데이터)은 전체 범위만. */
export function canAccessBranch(p: AdminPrincipal, branchId: number | null): boolean {
  const scope = effectiveScope(p);
  if (scope.kind === 'ALL') return true;
  if (scope.kind === 'NONE') return false;
  return branchId === scope.branchId;
}
