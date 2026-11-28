// 운영 설정 점검 (docs/07 "문제가 생기면"): DB 연결·개인정보 키·해시 페퍼가 제대로 들어갔는지만 알려 준다.
// 값·주소·개인정보는 돌려주지 않는다. 화면이 아니라 설정 확인용 응답이다.
import { customer } from '@aircon/db';
import { isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { errorCode } from '@/server/action-result';
import { getDb, isDbConfigured } from '@/server/db';
import { piiKeyStatus } from '@/server/pii';
import { recentErrors, scrub } from '@/server/recent-errors';

export const dynamic = 'force-dynamic';

/** DATABASE_URL 이 어떤 연결 방식인지(주소·비밀번호는 돌려주지 않음) */
function databaseMode(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return 'missing';
  try {
    const u = new URL(raw);
    if (u.hostname.endsWith('pooler.supabase.com')) return u.port === '6543' ? 'supabase-transaction-pooler' : `supabase-session-pooler(port ${u.port || '5432'})`;
    if (/^db\..+\.supabase\.co$/.test(u.hostname)) return 'supabase-direct';
    return 'other';
  } catch {
    return 'invalid-url';
  }
}

/** 오류 메시지에서 접속 주소·비밀번호처럼 보이는 부분을 지운다 */
function safeMessage(e: unknown): string {
  let cur: unknown = e;
  const parts: string[] = [];
  for (let i = 0; i < 3 && cur && typeof cur === 'object'; i++) {
    const m = (cur as { message?: unknown }).message;
    if (typeof m === 'string' && m) parts.push(m);
    cur = (cur as { cause?: unknown }).cause;
  }
  return scrub(parts.join(' / '));
}

export async function GET() {
  let db: 'ok' | 'missing' | 'error' = 'missing';
  let dbCode: string | null = null;
  let dbMessage: string | null = null;
  let concurrent: string | null = null;
  let samples: string[] = [];
  if (isDbConfigured()) {
    try {
      const rows = await getDb()
        .select({ name: customer.name })
        .from(customer)
        .where(isNull(customer.withdrawnAt))
        .orderBy(sql`${customer.id}`)
        .limit(20);
      db = 'ok';
      samples = rows.map((r) => r.name);
      // 화면들은 쿼리를 여러 개 동시에 보낸다: 같은 방식으로 10개를 한꺼번에 보내 본다
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => getDb().execute(sql`select pg_sleep(0.05)`)));
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      concurrent = failed.length ? `fail ${failed.length}/10: ${errorCode(failed[0]!.reason) ?? ''} ${safeMessage(failed[0]!.reason)}` : 'ok 10/10';
    } catch (e) {
      db = 'error';
      dbCode = errorCode(e) ?? 'unknown';
      dbMessage = safeMessage(e);
      console.error('[health] DB 연결 실패', e);
    }
  }
  const pii = piiKeyStatus(samples);
  const body = {
    ok: db === 'ok' && concurrent === 'ok 10/10' && pii.key === 'ok' && pii.decryptFail === 0 && Boolean(process.env.PII_HASH_PEPPER),
    database: db,
    databaseMode: databaseMode(),
    databaseErrorCode: dbCode,
    databaseError: dbMessage,
    databaseConcurrent: concurrent,
    piiKey: pii.key,
    piiDecryptOk: pii.decryptOk,
    piiDecryptFail: pii.decryptFail,
    piiHashPepper: process.env.PII_HASH_PEPPER ? 'set' : 'missing',
    authDriver: process.env.AUTH_DRIVER ?? 'mock',
    checkedAt: new Date().toISOString(),
    /** 이 서버 인스턴스에서 최근 난 화면 오류(Digest 로 화면의 오류와 맞춰 볼 수 있음) */
    recentErrors: recentErrors(),
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
