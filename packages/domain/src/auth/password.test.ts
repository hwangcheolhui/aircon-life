import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('비밀번호 해시', () => {
  it('맞는 비밀번호만 통과한다', () => {
    const h = hashPassword('test-pass-1');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('test-pass-1', h)).toBe(true);
    expect(verifyPassword('test-pass-2', h)).toBe(false);
    expect(verifyPassword('test-pass-1', 'garbage')).toBe(false);
  });
});
