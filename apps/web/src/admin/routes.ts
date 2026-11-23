/** 화면 ID → 관리자 경로 (/admin 하위). 페이지 파일 상단 주석의 화면 ID와 같다. */
export const ADMIN_ROUTES: Record<string, string> = {
  'A-AUTH-010': '/admin/login',
  'A-AUTH-020': '/admin/password',
  'A-DSP-050': '/admin/dsp/areas',
  'A-PRD-010': '/admin/prd/categories',
  'A-PRD-011': '/admin/prd/products',
  'A-PRD-020': '/admin/prd/prices',
  'A-PRD-030': '/admin/prd/surcharges',
  'A-PRD-040': '/admin/prd/options',
  'A-PRD-050': '/admin/prd/simulator',
  'A-SYS-010': '/admin/sys/accounts',
  'A-SYS-020': '/admin/sys/roles',
  'A-SYS-030': '/admin/sys/branches',
  'A-SYS-040': '/admin/sys/codes',
  'A-SYS-050': '/admin/sys/settings',
};

export function routeOf(screenId: string): string {
  return ADMIN_ROUTES[screenId] ?? '/admin';
}
