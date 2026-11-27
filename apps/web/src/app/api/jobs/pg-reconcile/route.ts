// F-SYS-14 PG 대사 (매일 05:00 KST = 20:00 UTC): 어제 승인된 PG 결제를 PG 서버에 다시 조회해 불일치가 있으면 운영자에게 PG_MISMATCH
import { type NextRequest, NextResponse } from 'next/server';
import { runPgReconcile } from '@/server/sys-jobs';
import { isDbConfigured } from '@/server/db';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const r = await runPgReconcile(new Date());
  return NextResponse.json({ ok: true, ...r });
}
