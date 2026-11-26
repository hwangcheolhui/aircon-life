// F-SYS-10 정산 회차 자동 생성 (BR-080): 매주 월요일 아침에 지난주(월~일) 전체 회차를 만들고(DRAFT) 바로 계산한다(CALCULATED, 기사에게 확인 요청 알림).
// vercel.json: 일요일 21:00 UTC = 월요일 06:00 KST, 주 1회(Vercel Hobby는 하루 1회까지 허용). 이미 계산된 회차는 건너뛴다.
// 수수료 정책이 없는 기사가 있으면 계산이 멈추고 회차는 작성(DRAFT)으로 남는다 → 정책 등록 뒤 A-STL-020 [계산].
import { type NextRequest, NextResponse } from 'next/server';
import { UserError } from '@/server/action-result';
import { isDbConfigured } from '@/server/db';
import { autoCreateWeeklyBatch } from '@/server/settlements';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ ok: false, message: 'DB 미연결' }, { status: 503 });
  try {
    return NextResponse.json({ ok: true, ...(await autoCreateWeeklyBatch(new Date())) });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ ok: false, message: e.message }, { status: 409 });
    throw e;
  }
}
