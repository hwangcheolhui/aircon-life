import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMockAuth } from './mock';
import type { CookieAccessor, CookieRecord } from './types';

function jar(): CookieAccessor & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getAll: () => [...store].map(([name, value]) => ({ name, value })),
    setAll: (list: CookieRecord[]) => list.forEach((c) => (c.value ? store.set(c.name, c.value) : store.delete(c.name))),
  };
}

describe('Mock 인증 어댑터', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'auth-')), 'users.json');
  const secret = 'test-secret-0123456789';

  it('계정 생성 → 로그인 → 세션 조회 → 로그아웃', async () => {
    const cookies = jar();
    const auth = createMockAuth({ file, secret, ttlMin: 10, cookies });
    const id = await auth.createUser('a@example.test', 'pw-1234abcd');
    expect(await auth.signInWithPassword('a@example.test', 'wrong')).toBeNull();
    expect(await auth.signInWithPassword('a@example.test', 'pw-1234abcd')).toEqual({ authUserId: id });
    expect(await auth.getSessionUserId()).toBe(id);
    await auth.signOut();
    expect(await auth.getSessionUserId()).toBeNull();
  });

  it('위조된 세션 쿠키는 거부한다', async () => {
    const cookies = jar();
    cookies.store.set('ac_mock_session', 'eyJzdWIiOiJ4IiwiZXhwIjo5OTk5OTk5OTk5OTk5fQ.bad');
    const auth = createMockAuth({ file, secret, ttlMin: 10, cookies });
    expect(await auth.getSessionUserId()).toBeNull();
  });

  it('비밀번호를 바꾸면 새 비밀번호로만 로그인된다', async () => {
    const auth = createMockAuth({ file, secret, ttlMin: 10, cookies: jar() });
    const id = await auth.createUser('b@example.test', 'old-pass-1');
    await auth.setPassword(id, 'new-pass-2');
    expect(await auth.signInWithPassword('b@example.test', 'old-pass-1')).toBeNull();
    expect(await auth.signInWithPassword('b@example.test', 'new-pass-2')).not.toBeNull();
  });
});
