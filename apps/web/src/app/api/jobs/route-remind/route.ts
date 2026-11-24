// F-SYS-16 ① 코스 확정 마감 1시간 전 미확정 알림 (Vercel Hobby 는 하루 1회·정시 지연 가능 → 08:00 UTC = 17시대 KST).
import { type NextRequest, NextResponse } from 'next/server';
import { isDbConfigured } from '@/server/db';
import { remindUnconfirmed } from '@/server/route-plans';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const r = await remindUnconfirmed(new Date());
  return NextResponse.json({ ok: true, ...r });
}
