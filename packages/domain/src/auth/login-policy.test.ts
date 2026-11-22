import { describe, expect, it } from 'vitest';
import { evaluateLogin, validatePasswordRule } from './login-policy';

const active = { status: 'ACTIVE' as const, loginFailCount: 0, deleted: false };

describe('관리자 로그인 잠금 (02 §7)', () => {
  it('성공하면 실패 횟수를 0으로 되돌린다', () => {
    expect(evaluateLogin({ ...active, loginFailCount: 3 }, true, 5)).toEqual({
      result: 'SUCCESS',
      next: { status: 'ACTIVE', loginFailCount: 0 },
    });
  });

  it('실패하면 횟수를 올리고 남은 횟수를 알려 준다', () => {
    expect(evaluateLogin(active, false, 5)).toMatchObject({ result: 'INVALID_CREDENTIALS', remaining: 4 });
  });

  it('5회째 실패에서 잠긴다', () => {
    expect(evaluateLogin({ ...active, loginFailCount: 4 }, false, 5)).toEqual({
      result: 'LOCKED',
      next: { status: 'LOCKED', loginFailCount: 5 },
    });
  });

  it('잠긴 계정은 비밀번호가 맞아도 로그인할 수 없다', () => {
    expect(evaluateLogin({ ...active, status: 'LOCKED', loginFailCount: 5 }, true, 5).result).toBe('LOCKED');
  });

  it('퇴사·삭제 계정은 로그인할 수 없다', () => {
    expect(evaluateLogin({ ...active, status: 'RETIRED' }, true, 5).result).toBe('UNAVAILABLE');
    expect(evaluateLogin({ ...active, deleted: true }, true, 5).result).toBe('UNAVAILABLE');
  });
});

describe('비밀번호 규칙', () => {
  it('최소 길이와 영문·숫자 조합을 검사한다', () => {
    expect(validatePasswordRule('abc123', 8)).not.toBeNull();
    expect(validatePasswordRule('abcdefgh', 8)).not.toBeNull();
    expect(validatePasswordRule('12345678', 8)).not.toBeNull();
    expect(validatePasswordRule('abcd1234', 8)).toBeNull();
  });
});
