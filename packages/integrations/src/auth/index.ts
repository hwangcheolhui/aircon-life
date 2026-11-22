import { createMockAuth } from './mock';
import { createSupabaseAuth } from './supabase';
import type { AuthAdapter, CookieAccessor } from './types';

export * from './types';
export { MOCK_SESSION_COOKIE } from './mock';

/** 환경변수로 Mock/Real을 고른다. AUTH_DRIVER=supabase|mock (기본 mock) */
export function createAuthAdapter(cookies: CookieAccessor, env: NodeJS.ProcessEnv = process.env): AuthAdapter {
  if (env.AUTH_DRIVER === 'supabase') {
    return createSupabaseAuth({
      url: env.SUPABASE_URL ?? '',
      anonKey: env.SUPABASE_ANON_KEY ?? '',
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      cookies,
    });
  }
  return createMockAuth({
    file: env.MOCK_AUTH_FILE ?? './storage/mock-auth.json',
    secret: env.SESSION_SECRET ?? '',
    ttlMin: Number(env.SESSION_TTL_MIN ?? 480),
    cookies,
  });
}
