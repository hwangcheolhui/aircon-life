// F-SYS-13 휴면 전환 (매일 03:30 KST = 18:30 UTC): DORMANT_ENABLED=Y 일 때만 사전 안내(DORMANT_NOTICE_DAYS일 전)·전환(DORMANT_MONTHS개월)
import { type NextRequest, NextResponse } from 'next/server';
import { runDormant } from '@/server/sys-jobs';
import { isDbConfigured } from '@/server/db';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const r = await runDormant(new Date());
  return NextResponse.json({ ok: true, ...r });
}
