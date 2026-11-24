// F-SYS-15 다음 날 코스 초안 생성 (매일 15:00 KST = Vercel Cron 06:00 UTC). 먼저 관할 구역 적용기간을 오늘 기준으로 다시 반영한다(F-ADM-DSP-08).
import { type NextRequest, NextResponse } from 'next/server';
import { isDbConfigured } from '@/server/db';
import { createRouteDrafts } from '@/server/route-plans';
import { syncAllZoneAreas } from '@/server/zones';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const zones = await syncAllZoneAreas();
  const r = await createRouteDrafts(new Date());
  return NextResponse.json({ ok: true, zones, ...r });
}
