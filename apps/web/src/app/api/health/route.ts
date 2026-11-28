// 운영 설정 점검 (docs/07 "문제가 생기면"): DB 연결·개인정보 키·해시 페퍼가 제대로 들어갔는지만 알려 준다.
// 값·주소·개인정보는 돌려주지 않는다. 화면이 아니라 설정 확인용 응답이다.
import { customer } from '@aircon/db';
import { isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { errorCode } from '@/server/action-result';
import { getDb, isDbConfigured } from '@/server/db';
import { piiKeyStatus } from '@/server/pii';

export const dynamic = 'force-dynamic';

export async function GET() {
  let db: 'ok' | 'missing' | 'error' = 'missing';
  let dbCode: string | null = null;
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
    } catch (e) {
      db = 'error';
      dbCode = errorCode(e) ?? 'unknown';
      console.error('[health] DB 연결 실패', e);
    }
  }
  const pii = piiKeyStatus(samples);
  const body = {
    ok: db === 'ok' && pii.key === 'ok' && pii.decryptFail === 0 && Boolean(process.env.PII_HASH_PEPPER),
    database: db,
    databaseErrorCode: dbCode,
    piiKey: pii.key,
    piiDecryptOk: pii.decryptOk,
    piiDecryptFail: pii.decryptFail,
    piiHashPepper: process.env.PII_HASH_PEPPER ? 'set' : 'missing',
    authDriver: process.env.AUTH_DRIVER ?? 'mock',
    checkedAt: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
