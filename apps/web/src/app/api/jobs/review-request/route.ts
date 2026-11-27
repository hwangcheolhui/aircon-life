// F-SYS-05 후기 요청 (매일 20:00 KST = 11:00 UTC, Vercel Hobby 하루 1회): 작업 완료 후 REVIEW_REQUEST_DELAY_HOURS시간이 지났고 후기가 없는 주문에 REVIEW_REQUEST 1회(REVIEW_WRITABLE_DAYS일 안)
import { type NextRequest, NextResponse } from 'next/server';
import { runReviewRequests } from '@/server/reviews';
import { isDbConfigured } from '@/server/db';
import { siteOrigin } from '@/server/site-origin';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const r = await runReviewRequests(await siteOrigin(), new Date());
  return NextResponse.json({ ok: true, ...r });
}
