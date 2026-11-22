/**
 * Mock 인증: 사용자 목록을 JSON 파일에 저장하고 HMAC 서명 쿠키로 세션을 유지한다. 운영에서 쓰지 않는다.
 */
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuthAdapter, CookieAccessor } from './types';

export const MOCK_SESSION_COOKIE = 'ac_mock_session';

interface MockUser {
  id: string;
  email: string;
  salt: string;
  hash: string;
}

export interface MockAuthOptions {
  file: string;
  secret: string;
  ttlMin: number;
  cookies: CookieAccessor;
}

function load(file: string): MockUser[] {
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')) as MockUser[];
}
function save(file: string, users: MockUser[]) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(users, null, 2));
}
function hash(pw: string, salt: string) {
  return scryptSync(pw, Buffer.from(salt, 'base64'), 32).toString('base64');
}
function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createMockAuth(o: MockAuthOptions): AuthAdapter {
  if (!o.secret || o.secret.length < 16) throw new Error('SESSION_SECRET(16자 이상)이 필요합니다.');
  const issue = (userId: string) => {
    const exp = Date.now() + o.ttlMin * 60_000;
    const payload = Buffer.from(JSON.stringify({ sub: userId, exp })).toString('base64url');
    o.cookies.setAll([
      {
        name: MOCK_SESSION_COOKIE,
        value: `${payload}.${sign(payload, o.secret)}`,
        options: { httpOnly: true, sameSite: 'lax', path: '/', maxAge: o.ttlMin * 60 },
      },
    ]);
  };
  const update = (id: string, fn: (u: MockUser) => void) => {
    const users = load(o.file);
    const u = users.find((x) => x.id === id);
    if (!u) throw new Error('사용자를 찾을 수 없습니다.');
    fn(u);
    save(o.file, users);
  };
  return {
    async signInWithPassword(email, password) {
      const u = load(o.file).find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (!u) return null;
      const a = Buffer.from(hash(password, u.salt));
      const b = Buffer.from(u.hash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      issue(u.id);
      return { authUserId: u.id };
    },
    async getSessionUserId() {
      const raw = o.cookies.getAll().find((c) => c.name === MOCK_SESSION_COOKIE)?.value;
      if (!raw) return null;
      const [payload, sig] = raw.split('.');
      if (!payload || !sig || sign(payload, o.secret) !== sig) return null;
      const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub: string; exp: number };
      return exp > Date.now() ? sub : null;
    },
    async signOut() {
      o.cookies.setAll([{ name: MOCK_SESSION_COOKIE, value: '', options: { path: '/', maxAge: 0 } }]);
    },
    async createUser(email, password) {
      const users = load(o.file);
      if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) throw new Error('이미 등록된 이메일입니다.');
      const salt = randomBytes(16).toString('base64');
      const user = { id: randomUUID(), email, salt, hash: hash(password, salt) };
      save(o.file, [...users, user]);
      return user.id;
    },
    async setPassword(id, password) {
      update(id, (u) => {
        u.salt = randomBytes(16).toString('base64');
        u.hash = hash(password, u.salt);
      });
    },
    async setEmail(id, email) {
      update(id, (u) => {
        u.email = email;
      });
    },
  };
}
