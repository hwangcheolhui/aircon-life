import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>['db'];

/**
 * 서버 전용 DB 연결. Supabase에서는 서버 측 연결 문자열(Pooler, transaction 모드)을 쓴다.
 * 이 연결은 RLS를 우회하므로 반드시 서버 코드의 권한 검사(requirePermission)를 거친 뒤 사용한다.
 */
export function createDb(url: string, opts: { max?: number } = {}) {
  const sql = postgres(url, { max: opts.max ?? 5, prepare: false });
  return { sql, db: drizzle(sql, { schema }) };
}
