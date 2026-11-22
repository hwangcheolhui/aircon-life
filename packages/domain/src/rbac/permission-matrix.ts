/**
 * 03_IA §4.4 역할별 메뉴 권한 매트릭스 → (role_code, menu_code, action) 목록.
 * R=조회(READ) · W=등록/수정(READ+CREATE+UPDATE+DELETE) · A=승인/확정(APPROVE) · 미표기=메뉴 숨김.
 * 시드(packages/db)와 테스트가 이 표를 단일 출처로 쓴다. 매트릭스가 바뀌면 03 §4.4와 함께 고친다.
 */
import { allAdminScreens } from './admin-menus';

export const ADMIN_ROLE_CODES = ['ADM_CS', 'ADM_OPS', 'ADM_BRANCH', 'ADM_FIN', 'ADM_MKT', 'ADM_SUPER'] as const;
export type AdminRoleCode = (typeof ADMIN_ROLE_CODES)[number];

export const PERMISSION_ACTIONS = ['READ', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'APPROVE'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

type Cell = 'R' | 'W' | 'A' | 'WA' | 'RC' | null;
/** 셀이 영역 일부 화면에만 해당할 때 (예: 상담원 "R(Time Table)") */
type CellSpec = Cell | { cell: Cell; only: string[] };

interface MatrixRow {
  label: string;
  /** 대상 화면: 접두(예: 'A-CSL-')는 영역 전체, 정확한 ID는 그 화면만 */
  screens: string[];
  cells: Record<AdminRoleCode, CellSpec>;
}

const row = (
  label: string,
  screens: string[],
  cs: CellSpec,
  ops: CellSpec,
  branch: CellSpec,
  fin: CellSpec,
  mkt: CellSpec,
  sup: CellSpec,
): MatrixRow => ({
  label,
  screens,
  cells: { ADM_CS: cs, ADM_OPS: ops, ADM_BRANCH: branch, ADM_FIN: fin, ADM_MKT: mkt, ADM_SUPER: sup },
});

/** 03 §4.4 표의 행 순서 그대로. 정확한 화면 ID 행이 접두 행보다 우선한다. */
export const PERMISSION_MATRIX: readonly MatrixRow[] = [
  row('대시보드 운영', ['A-DSH-010'], 'R', 'R', 'R', 'R', 'R', 'R'),
  row('대시보드 KPI', ['A-DSH-020'], null, null, 'R', 'R', 'R', 'R'),
  row('상담 콘솔', ['A-CSL-'], 'W', 'W', 'W', null, null, 'W'),
  row('접수·주문', ['A-ORD-'], 'RC', 'W', 'W', 'R', null, 'W'),
  row('배정·일정', ['A-DSP-'], { cell: 'R', only: ['A-DSP-030'] }, 'W', 'WA', null, null, 'W'),
  row('관할 지역', ['A-DSP-050'], null, 'R', 'W', null, null, 'W'),
  row('기사 관할 구역·코스 모니터링', ['A-DSP-060', 'A-DSP-070'], null, 'W', 'WA', null, null, 'W'),
  row('처리 콘솔', ['A-PRC-'], 'R', 'W', 'WA', 'R', null, 'W'),
  row('추가요금 승인', ['A-PRC-040'], null, 'A', 'A', 'R', null, 'A'),
  row('고객', ['A-CUS-'], 'W', 'W', 'W', 'R', 'R', 'W'),
  row('파기 관리', ['A-CUS-030'], null, null, null, null, null, 'A'),
  row('기사', ['A-TEC-'], 'R', 'W', 'WA', 'R', null, 'W'),
  row('상품·가격', ['A-PRD-'], 'R', 'R', 'R', 'R', 'R', 'W'),
  row('결제', ['A-PAY-'], 'R', 'R', 'R', 'WA', null, 'W'),
  row('정산', ['A-STL-'], null, null, 'R', 'WA', null, 'WA'),
  row('VOC·AS·안전', ['A-VOC-'], 'W', 'W', 'WA', 'R', { cell: 'R', only: ['A-VOC-040'] }, 'W'),
  row('마케팅', ['A-CRM-'], null, null, 'R', null, 'W', 'W'),
  row('B2B', ['A-B2B-'], 'R', 'W', 'W', 'R', 'R', 'W'),
  row(
    '콘텐츠',
    ['A-CNT-'],
    { cell: 'W', only: ['A-CNT-020'] }, // 상담원: R(FAQ W) → FAQ만 W, 나머지 R (아래 보정)
    { cell: 'W', only: ['A-CNT-040'] }, // 운영자: W(메모)
    'W',
    null,
    'W',
    'W',
  ),
  row(
    '통계',
    ['A-STA-'],
    null,
    { cell: 'R', only: ['A-STA-020'] },
    'R',
    { cell: 'R', only: ['A-STA-010'] },
    { cell: 'R', only: ['A-STA-040'] },
    'R',
  ),
  row('시스템', ['A-SYS-'], null, null, null, null, null, 'W'),
];

/** 상담원 콘텐츠 "R(FAQ W)"의 R 부분: FAQ 외 콘텐츠 화면 조회 */
const CS_CONTENT_READ = 'A-CNT-';

/** 엑셀 다운로드 행: 조회 가능한 화면에 EXPORT 부여 (상담원 제외) */
const EXPORT_ROLES: readonly AdminRoleCode[] = ['ADM_OPS', 'ADM_BRANCH', 'ADM_FIN', 'ADM_MKT', 'ADM_SUPER'];

function cellActions(cell: Cell): PermissionAction[] {
  switch (cell) {
    case 'R':
      return ['READ'];
    case 'RC':
      return ['READ', 'CREATE'];
    case 'W':
      return ['READ', 'CREATE', 'UPDATE', 'DELETE'];
    case 'A':
      return ['READ', 'APPROVE'];
    case 'WA':
      return ['READ', 'CREATE', 'UPDATE', 'DELETE', 'APPROVE'];
    default:
      return [];
  }
}

function matchesExact(row: MatrixRow, screenId: string) {
  return row.screens.includes(screenId);
}
function matchesPrefix(row: MatrixRow, screenId: string) {
  return row.screens.some((s) => s.endsWith('-') && screenId.startsWith(s));
}

/** 화면에 적용되는 행: 정확한 ID 행 우선, 없으면 접두 행 */
function rowFor(screenId: string): MatrixRow | undefined {
  return PERMISSION_MATRIX.find((r) => matchesExact(r, screenId)) ?? PERMISSION_MATRIX.find((r) => matchesPrefix(r, screenId));
}

export type PermissionKey = `${string}:${PermissionAction}`;
export const permissionKey = (menuCode: string, action: PermissionAction): PermissionKey => `${menuCode}:${action}`;

/** 역할별 권한 키 집합을 만든다. */
export function buildRolePermissions(): Record<AdminRoleCode, Set<PermissionKey>> {
  const result = Object.fromEntries(ADMIN_ROLE_CODES.map((r) => [r, new Set<PermissionKey>()])) as Record<
    AdminRoleCode,
    Set<PermissionKey>
  >;
  for (const screen of allAdminScreens()) {
    const r = rowFor(screen.screenId);
    if (!r) continue;
    for (const role of ADMIN_ROLE_CODES) {
      const spec = r.cells[role];
      let actions: PermissionAction[] = [];
      if (spec && typeof spec === 'object') {
        if (spec.only.includes(screen.screenId)) actions = cellActions(spec.cell);
      } else {
        actions = cellActions(spec);
      }
      if (role === 'ADM_CS' && actions.length === 0 && screen.screenId.startsWith(CS_CONTENT_READ)) {
        actions = ['READ'];
      }
      for (const a of actions) result[role].add(permissionKey(screen.screenId, a));
      if (actions.includes('READ') && EXPORT_ROLES.includes(role)) {
        result[role].add(permissionKey(screen.screenId, 'EXPORT'));
      }
    }
  }
  return result;
}

/** permission 테이블 시드용: 모든 화면 × 모든 행위 */
export function allPermissionPairs(): { menuCode: string; action: PermissionAction }[] {
  return allAdminScreens().flatMap((s) => PERMISSION_ACTIONS.map((action) => ({ menuCode: s.screenId, action })));
}
