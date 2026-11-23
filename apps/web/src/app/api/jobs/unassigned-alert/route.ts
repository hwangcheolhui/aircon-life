// F-SYS-09 미지정 건 경고 배치: 약속이 UNASSIGNED_ALERT_HOURS(기본 4시간) 이내인데 기사가 정해지지 않은(ASSIGN_WAIT) 예약마다 운영자 경고 1회.
// 기능정의서 주기는 15분이지만 Vercel Hobby 요금제는 하루 1회 Cron만 허용하므로 vercel.json 에 넣지 않는다.
// 배정 보드(A-DSP-010)를 열 때도 같은 점검이 돌고, 보드 상단에 임박 미지정 건이 표시된다. 외부 스케줄러(예: GitHub Actions)로 15분마다 호출할 수 있다.
import { type NextRequest, NextResponse } from 'next/server';
import { isDbConfigured } from '@/server/db';
import { alertUnassigned } from '@/server/dispatch';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  const sent = await alertUnassigned(new Date());
  return NextResponse.json({ ok: true, sent });
}
