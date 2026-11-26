// F-SYS-12 개인정보 파기 (매일 03:00 KST = 18:00 UTC): 파기 예정일이 지난 고객. PURGE_APPROVAL_MODE=Y 면 대상만 세고 A-CUS-030 승인을 기다린다. 파기마다 감사 로그(SYSTEM)
import { type NextRequest, NextResponse } from 'next/server';
import { isDbConfigured } from '@/server/db';
import { runPiiPurge } from '@/server/purge';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const r = await runPiiPurge(new Date());
  return NextResponse.json({ ok: true, ...r });
}
