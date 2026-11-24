// F-SYS-08 장기 미처리 경고 배치 (BR-032): PENDING 후 PENDING_OVERDUE_HOURS(기본 48시간)가 지난 주문마다 운영자 알림 1회.
// 기능정의서 주기는 매시이지만 Vercel Hobby 요금제는 하루 1회 Cron만 허용하므로 vercel.json 에 하루 1회(00:00 UTC = 09시 KST)로 등록한다.
// 장기 미처리 색상 강조는 배치와 상관없이 화면(기사 작업 목록·관리자 주문 목록)을 열 때 바로 계산한다.
import { type NextRequest, NextResponse } from 'next/server';
import { isDbConfigured } from '@/server/db';
import { alertLongPending } from '@/server/pending';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const sent = await alertLongPending(new Date());
  return NextResponse.json({ ok: true, sent });
}
