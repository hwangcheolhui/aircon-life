/**
 * 임시 개발 모드(ADMIN_AUTH_BYPASS) — 로그인 없이 관리자 화면을 "읽기 전용"으로 열람하는 가상 주체.
 * 구현 기간에만 쓰고 운영 전 반드시 끈다(02 §7). 조회(READ) 외 권한은 절대 주지 않는다.
 */
import { type AdminScreen, type ImplementationStage, PUBLIC_ADMIN_SCREENS, RELEASED_STAGES, allAdminScreens, isScreenReleased } from './admin-menus';
import { type PermissionKey, permissionKey } from './permission-matrix';

export const PREVIEW_ROLE_CODE = 'PREVIEW';

/** 구현이 끝난 관리자 화면 전체에 대한 READ 권한만 */
export function previewPermissions(released: readonly ImplementationStage[] = RELEASED_STAGES): PermissionKey[] {
  const isPublic = (s: AdminScreen) => (PUBLIC_ADMIN_SCREENS as readonly string[]).includes(s.screenId);
  return allAdminScreens()
    .filter((s) => isScreenReleased(s, released) && !isPublic(s))
    .map((s) => permissionKey(s.screenId, 'READ'));
}
