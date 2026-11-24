import { describe, expect, it } from 'vitest';
import { hasPermission } from './access';
import { PREVIEW_ROLE_CODE, previewPermissions } from './preview';

const preview = { adminId: 0, roleCode: PREVIEW_ROLE_CODE, dataScope: 'ALL' as const, branchId: null, permissions: previewPermissions() };

describe('임시 개발 모드 열람 주체', () => {
  it('구현된 관리자 화면은 조회할 수 있다', () => {
    for (const menu of ['A-SYS-010', 'A-SYS-030', 'A-DSP-050', 'A-DSP-060', 'A-PRD-011', 'A-PRD-020']) expect(hasPermission(preview, menu, 'READ')).toBe(true);
  });
  it('등록·수정·삭제·다운로드 권한은 하나도 없다', () => {
    for (const key of previewPermissions()) expect(key.endsWith(':READ')).toBe(true);
    expect(hasPermission(preview, 'A-SYS-010', 'UPDATE')).toBe(false);
    expect(hasPermission(preview, 'A-PRD-011', 'CREATE')).toBe(false);
  });
  it('아직 구현하지 않은 단계의 화면은 포함하지 않는다', () => {
    expect(hasPermission(preview, 'A-DSP-070', 'READ')).toBe(false);
  });
});
