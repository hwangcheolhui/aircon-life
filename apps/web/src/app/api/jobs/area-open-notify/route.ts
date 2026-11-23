// F-SYS-19 오픈 알림 재시도·만료 배치 (매일 10:00 KST = Vercel Cron 01:00 UTC, vercel.json crons)
// ① 서비스 가능 지역인데 아직 WAITING 인 신청에 오픈 안내 재발송 ② 보관일(AREA_OPEN_REQUEST_KEEP_DAYS) 지난 WAITING 신청 만료·연락처 삭제 (BR-003)
import { type NextRequest, NextResponse } from 'next/server';
import { runAreaOpenJob } from '@/server/area-open';
import { isDbConfigured } from '@/server/db';

export const dynamic = 'force-dynamic';

/** Vercel Cron 은 CRON_SECRET 이 설정돼 있으면 Authorization: Bearer <CRON_SECRET> 를 붙여 호출한다 */
function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const r = await runAreaOpenJob(new Date());
  return NextResponse.json({ ok: true, ...r });
}
