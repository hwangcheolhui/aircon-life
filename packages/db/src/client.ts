import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>['db'];

/**
 * 서버 전용 DB 연결. Supabase에서는 서버 측 연결 문자열(Pooler, transaction 모드)을 쓴다.
 * 이 연결은 RLS를 우회하므로 반드시 서버 코드의 권한 검사(requirePermission)를 거친 뒤 사용한다.
 */
export function createDb(url: string, opts: { max?: number } = {}) {
  // 서버리스(Vercel)에서는 인스턴스가 멈춘 채 연결을 붙잡아 Pooler 연결 수가 차기 쉽다:
  // 쉬는 연결은 20초 뒤 닫고, 연결 시도는 10초에서 끊고, 연결 하나는 30분까지만 쓴다.
  const sql = postgres(url, { max: opts.max ?? 5, prepare: false, idle_timeout: 20, connect_timeout: 10, max_lifetime: 60 * 30 });
  return { sql, db: drizzle(sql, { schema }) };
}
