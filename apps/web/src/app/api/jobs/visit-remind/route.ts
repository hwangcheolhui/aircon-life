// F-SYS-03 방문 전날 알림 배치 (매일 18:00 KST = Vercel Cron 09:00 UTC, vercel.json crons). 알림톡 실패 시 문자 대체.
import { type NextRequest, NextResponse } from 'next/server';
import { isDbConfigured } from '@/server/db';
import { remindVisits } from '@/server/orders';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const sent = await remindVisits(new Date());
  return NextResponse.json({ ok: true, sent });
}
