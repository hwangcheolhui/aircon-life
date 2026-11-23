// F-SYS-01 슬롯 자동 생성 배치 (매일 00:10 KST = Vercel Cron 15:10 UTC, vercel.json crons)
// 기사 근무표(work_schedule) → 내일부터 SLOT_DAYS_AHEAD 일의 time_slot. 이미 있는 칸(수동 조정 포함)은 그대로 둔다.
import { type NextRequest, NextResponse } from 'next/server';
import { isDbConfigured } from '@/server/db';
import { generateSlots } from '@/server/slots';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const created = await generateSlots(new Date());
  return NextResponse.json({ ok: true, created });
}
