import 'server-only';
import { createDb } from '@aircon/db';

/**
 * 서버 전용 DB 연결 (RLS 우회). 모든 사용처는 requirePermission()으로 권한을 먼저 확인한다.
 * Vercel 서버리스에서는 Supabase Pooler(transaction 모드) 연결 문자열을 DATABASE_URL로 쓴다.
 */
const g = globalThis as unknown as { __acDb?: ReturnType<typeof createDb> };
export function getDb() {
  if (!g.__acDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL이 설정되지 않았습니다.');
    g.__acDb = createDb(url, { max: Number(process.env.DB_POOL_MAX ?? 5) });
  }
  return g.__acDb.db;
}
