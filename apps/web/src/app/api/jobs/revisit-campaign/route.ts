// F-SYS-06 재방문 대상 추출·발송 (매일 10:00 KST = Vercel Cron 01:00 UTC, vercel.json crons): BR-091 최근 작업 후 REVISIT_MONTHS개월 · BR-101 마케팅 동의 고객만
import { type NextRequest, NextResponse } from 'next/server';
import { runRevisitCampaign } from '@/server/crm';
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
  const r = await runRevisitCampaign(await siteOrigin(), new Date());
  return NextResponse.json({ ok: true, ...r });
}
