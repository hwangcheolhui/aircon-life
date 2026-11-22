/**
 * Real 인증: Supabase Auth. 세션은 @supabase/ssr 쿠키, 계정 관리는 service role 관리자 API.
 * SUPABASE_SERVICE_ROLE_KEY는 서버에서만 읽는다(브라우저 번들에 넣지 않음).
 */
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { AuthAdapter, CookieAccessor } from './types';

export interface SupabaseAuthOptions {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  cookies: CookieAccessor;
}

export function createSupabaseAuth(o: SupabaseAuthOptions): AuthAdapter {
  if (!o.url || !o.anonKey || !o.serviceRoleKey) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  }
  const client = createServerClient(o.url, o.anonKey, {
    cookies: {
      getAll: () => o.cookies.getAll(),
      setAll: (list) => o.cookies.setAll(list.map((c) => ({ name: c.name, value: c.value, options: c.options }))),
    },
  });
  const admin = () =>
    createClient(o.url, o.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } }).auth.admin;

  return {
    async signInWithPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.user) return null;
      return { authUserId: data.user.id };
    },
    async getSessionUserId() {
      const { data } = await client.auth.getUser();
      return data.user?.id ?? null;
    },
    async signOut() {
      await client.auth.signOut();
    },
    async createUser(email, password) {
      const { data, error } = await admin().createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(error?.message ?? '인증 계정을 만들지 못했습니다.');
      return data.user.id;
    },
    async setPassword(id, password) {
      const { error } = await admin().updateUserById(id, { password });
      if (error) throw new Error(error.message);
    },
    async setEmail(id, email) {
      const { error } = await admin().updateUserById(id, { email, email_confirm: true });
      if (error) throw new Error(error.message);
    },
  };
}
