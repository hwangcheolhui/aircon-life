// F-SYS-02 견적 만료 배치 (매일 01:00 KST = Vercel Cron 16:00 UTC, vercel.json crons)
// 유효기한(BR-015)이 지난 견적을 EXPIRED 로 바꾼다. 전이 가능 상태는 domain QUOTE_EXPIRABLE_STATUSES(01 §3.8).
import { type NextRequest, NextResponse } from 'next/server';
import { isDbConfigured } from '@/server/db';
import { expireQuotes } from '@/server/quote';

export const dynamic = 'force-dynamic';

/** Vercel Cron 은 CRON_SECRET 이 설정돼 있으면 Authorization: Bearer <CRON_SECRET> 를 붙여 호출한다 */
function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const expired = await expireQuotes(new Date());
  return NextResponse.json({ ok: true, expired });
}
