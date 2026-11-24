/** 화면 ID → 관리자 경로 (/admin 하위). 페이지 파일 상단 주석의 화면 ID와 같다. */
export const ADMIN_ROUTES: Record<string, string> = {
  'A-AUTH-010': '/admin/login',
  'A-AUTH-020': '/admin/password',
  'A-ORD-010': '/admin/ord/orders',
  'A-ORD-030': '/admin/ord/requests',
  'A-ORD-040': '/admin/ord/new',
  'A-CSL-010': '/admin/csl/console',
  'A-CSL-070': '/admin/csl/history',
  'A-CUS-010': '/admin/cus/customers',
  'A-DSP-010': '/admin/dsp/board',
  'A-DSP-020': '/admin/dsp/transfers',
  'A-DSP-030': '/admin/dsp/slots',
  'A-DSP-040': '/admin/dsp/schedules',
  'A-DSP-050': '/admin/dsp/areas',
  'A-DSP-060': '/admin/dsp/zones',
  'A-PRC-040': '/admin/prc/extra-charges',
  'A-TEC-010': '/admin/tec/technicians',
  'A-TEC-020': '/admin/tec/technicians',
  'A-CNT-050': '/admin/cnt/scripts',
  'A-CRM-040': '/admin/crm/templates',
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
