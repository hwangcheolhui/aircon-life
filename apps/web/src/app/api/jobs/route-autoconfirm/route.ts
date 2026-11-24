// F-SYS-16 ② 마감(ROUTE_CONFIRM_DEADLINE, 기본 18:00) 지난 미확정 코스 자동 확정 (09:00 UTC = 18시대 KST).
// Cron 이 늦게 돌아도 기사 코스 화면·고객 예약 상세를 열 때 같은 자동 확정이 먼저 실행된다(route-plans.getRouteView·customerVisitInfo).
import { type NextRequest, NextResponse } from 'next/server';
import { isDbConfigured } from '@/server/db';
import { autoConfirmDue } from '@/server/route-plans';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const r = await autoConfirmDue(new Date());
  return NextResponse.json({ ok: true, ...r });
}
