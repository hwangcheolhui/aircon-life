// F-SYS-18 위치 기록 정리 (매일 04:00 KST = 19:00 UTC): 일별 이동거리 집계 후 보관기간(LOCATION_RETENTION_DAYS) 지난 원본 삭제.
import { type NextRequest, NextResponse } from 'next/server';
import { isDbConfigured } from '@/server/db';
import { purgeLocations } from '@/server/tech-duty';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const r = await purgeLocations(new Date());
  return NextResponse.json({ ok: true, ...r });
}
