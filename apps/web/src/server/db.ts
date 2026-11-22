import 'server-only';
import { createDb } from '@aircon/db';

type Db = ReturnType<typeof createDb>['db'];

/** DATABASE_URL 이 설정돼 있는지. 없으면 "DB 미연결" 상태로 화면만 띄운다(구현 기간 열람용). */
export const isDbConfigured = () => Boolean(process.env.DATABASE_URL);
export const DB_OFFLINE_MESSAGE = 'DB 미연결: 데이터베이스(DATABASE_URL)가 아직 설정되지 않아 로그인·저장을 할 수 없습니다.';

/**
 * DB 미연결용 빈 DB: 어떤 조회든 빈 배열로 끝난다. 쓰기는 서버 액션에서 먼저 막는다
 * (임시 개발 모드 열람자는 READ만, 로그인은 DB 없이 불가).
 */
function offlineDb(): Db {
  const handler: ProxyHandler<() => unknown> = {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: unknown[]) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve([]).then(ok, fail);
      if (prop === 'catch' || prop === 'finally') return () => Promise.resolve([]);
      if (prop === 'transaction') return (fn: (tx: unknown) => unknown) => fn(proxy);
      return proxy;
    },
    apply: () => proxy,
  };
  const proxy: unknown = new Proxy(() => undefined, handler);
  return proxy as Db;
}

/**
 * 서버 전용 DB 연결 (RLS 우회). 모든 사용처는 requirePermission()으로 권한을 먼저 확인한다.
 * Vercel 서버리스에서는 Supabase Pooler(transaction 모드) 연결 문자열을 DATABASE_URL로 쓴다.
 */
const g = globalThis as unknown as { __acDb?: ReturnType<typeof createDb>; __acOfflineDb?: Db };
export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) return (g.__acOfflineDb ??= offlineDb());
  g.__acDb ??= createDb(url, { max: Number(process.env.DB_POOL_MAX ?? 5) });
  return g.__acDb.db;
}
