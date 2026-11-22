import { describe, expect, it } from 'vitest';
import {
  type AdminPrincipal,
  canAccessBranch,
  effectiveScope,
  hasPermission,
  resolveBranchFilter,
  visibleAdminMenu,
} from './access';
import { type AdminRoleCode, buildRolePermissions } from './permission-matrix';

const perms = buildRolePermissions();
const principal = (
  roleCode: AdminRoleCode,
  dataScope: AdminPrincipal['dataScope'],
  branchId: number | null,
): AdminPrincipal => ({ adminId: 1, roleCode, dataScope, branchId, permissions: perms[roleCode] });

describe('BR-102 거점 데이터 범위', () => {
  it('BR-102 본사 소속(거점 없음) 전체 범위 관리자는 전체 거점을 조회한다', () => {
    const p = principal('ADM_SUPER', 'ALL', null);
    expect(effectiveScope(p)).toEqual({ kind: 'ALL' });
    expect(resolveBranchFilter(p)).toEqual({ kind: 'ALL' });
    expect(resolveBranchFilter(p, 3)).toEqual({ kind: 'BRANCH', branchId: 3 });
    expect(canAccessBranch(p, 3)).toBe(true);
    expect(canAccessBranch(p, null)).toBe(true);
  });

  it('BR-102 거점장은 다른 거점을 선택해도 자기 거점으로 고정된다', () => {
    const p = principal('ADM_BRANCH', 'BRANCH', 1);
    expect(resolveBranchFilter(p, 2)).toEqual({ kind: 'BRANCH', branchId: 1 });
    expect(canAccessBranch(p, 1)).toBe(true);
    expect(canAccessBranch(p, 2)).toBe(false);
  });

  it('BR-102 거점 소속 운영자는 역할 범위가 ALL이어도 자기 거점만 조회한다', () => {
    const p = principal('ADM_OPS', 'ALL', 5);
    expect(resolveBranchFilter(p)).toEqual({ kind: 'BRANCH', branchId: 5 });
  });

  it('BR-102 예외: 거점 범위 역할인데 소속 거점이 없으면 아무 데이터도 보지 않는다', () => {
    const p = principal('ADM_BRANCH', 'BRANCH', null);
    expect(resolveBranchFilter(p, 1)).toEqual({ kind: 'NONE' });
    expect(canAccessBranch(p, 1)).toBe(false);
  });

  it('BR-102 예외: 거점 소속 관리자는 전 거점 공통(branch_id NULL) 데이터를 수정할 수 없다', () => {
    expect(canAccessBranch(principal('ADM_BRANCH', 'BRANCH', 1), null)).toBe(false);
  });
});

describe('역할별 메뉴 노출 (03 §4.4)', () => {
  const menuIds = (role: AdminRoleCode, scope: AdminPrincipal['dataScope'] = 'ALL') =>
    visibleAdminMenu(principal(role, scope, null), ['0']).flatMap((g) => g.screens.map((s) => s.screenId));

  it('슈퍼관리자는 단계 0 화면 11개(로그인 제외)를 모두 본다', () => {
    expect(menuIds('ADM_SUPER')).toEqual([
      'A-DSP-050',
      'A-PRD-010',
      'A-PRD-011',
      'A-PRD-020',
      'A-PRD-030',
      'A-PRD-040',
      'A-SYS-010',
      'A-SYS-020',
      'A-SYS-030',
      'A-SYS-040',
      'A-SYS-050',
    ]);
  });

  it('상담원은 시스템·관할 지역 메뉴가 숨겨지고 상품·가격만 본다', () => {
    const ids = menuIds('ADM_CS');
    expect(ids.some((id) => id.startsWith('A-SYS'))).toBe(false);
    expect(ids).not.toContain('A-DSP-050');
    expect(ids).toContain('A-PRD-011');
  });

  it('운영자는 관할 지역을 조회만, 거점장은 수정까지 할 수 있다', () => {
    const ops = principal('ADM_OPS', 'ALL', null);
    const br = principal('ADM_BRANCH', 'BRANCH', 1);
    expect(hasPermission(ops, 'A-DSP-050', 'READ')).toBe(true);
    expect(hasPermission(ops, 'A-DSP-050', 'UPDATE')).toBe(false);
    expect(hasPermission(br, 'A-DSP-050', 'UPDATE')).toBe(true);
  });

  it('상품·가격은 슈퍼관리자만 등록·수정한다', () => {
    for (const role of ['ADM_CS', 'ADM_OPS', 'ADM_BRANCH', 'ADM_FIN', 'ADM_MKT'] as const) {
      expect(hasPermission(principal(role, 'ALL', null), 'A-PRD-020', 'READ')).toBe(true);
      expect(hasPermission(principal(role, 'ALL', null), 'A-PRD-020', 'CREATE')).toBe(false);
    }
    expect(hasPermission(principal('ADM_SUPER', 'ALL', null), 'A-PRD-020', 'CREATE')).toBe(true);
  });

  it('매트릭스 세부 셀: 상담원 배정·일정은 Time Table(A-DSP-030)만, 마케터 VOC는 후기만', () => {
    const cs = principal('ADM_CS', 'ALL', null);
    expect(hasPermission(cs, 'A-DSP-030', 'READ')).toBe(true);
    expect(hasPermission(cs, 'A-DSP-010', 'READ')).toBe(false);
    const mkt = principal('ADM_MKT', 'ALL', null);
    expect(hasPermission(mkt, 'A-VOC-040', 'READ')).toBe(true);
    expect(hasPermission(mkt, 'A-VOC-010', 'READ')).toBe(false);
  });

  it('상담원은 FAQ만 수정하고 다른 콘텐츠는 조회만 한다', () => {
    const cs = principal('ADM_CS', 'ALL', null);
    expect(hasPermission(cs, 'A-CNT-020', 'UPDATE')).toBe(true);
    expect(hasPermission(cs, 'A-CNT-010', 'READ')).toBe(true);
    expect(hasPermission(cs, 'A-CNT-010', 'UPDATE')).toBe(false);
  });

  it('추가요금 승인·파기 관리는 승인 권한으로 분리된다', () => {
    expect(hasPermission(principal('ADM_OPS', 'ALL', null), 'A-PRC-040', 'APPROVE')).toBe(true);
    expect(hasPermission(principal('ADM_OPS', 'ALL', null), 'A-PRC-040', 'UPDATE')).toBe(false);
    expect(hasPermission(principal('ADM_SUPER', 'ALL', null), 'A-CUS-030', 'APPROVE')).toBe(true);
    expect(hasPermission(principal('ADM_BRANCH', 'BRANCH', 1), 'A-CUS-030', 'READ')).toBe(false);
  });

  it('엑셀 다운로드(EXPORT)는 상담원에게 없다', () => {
    expect(hasPermission(principal('ADM_CS', 'ALL', null), 'A-PRD-011', 'EXPORT')).toBe(false);
    expect(hasPermission(principal('ADM_FIN', 'ALL', null), 'A-PRD-011', 'EXPORT')).toBe(true);
  });

  it('미구현 단계 화면은 권한이 있어도 메뉴에 나오지 않는다', () => {
    expect(menuIds('ADM_SUPER')).not.toContain('A-ORD-010');
  });
});
