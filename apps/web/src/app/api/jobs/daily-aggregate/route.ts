// F-SYS-11 일 집계 (매일 02:00 KST = 17:00 UTC): 고객 최근 작업일·누적 주문·파기 예정일, 기사 VOC 건수, 재방문 작업이 끝난 AS 완료, 캠페인 예약 전환
import { type NextRequest, NextResponse } from 'next/server';
import { isDbConfigured } from '@/server/db';
import { runDailyAggregate } from '@/server/purge';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const r = await runDailyAggregate(new Date());
  return NextResponse.json({ ok: true, ...r });
}
