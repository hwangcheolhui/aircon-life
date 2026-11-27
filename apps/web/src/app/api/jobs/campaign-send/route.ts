// F-ADM-CRM-02 예약 캠페인 발송 (매일 10:30 KST = 01:30 UTC, Vercel Hobby 하루 1회): 예약(SCHEDULED) 시각이 지난 캠페인을 발송. 마케팅 동의 고객만(BR-101)
import { type NextRequest, NextResponse } from 'next/server';
import { runScheduledCampaigns } from '@/server/campaigns';
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
  const r = await runScheduledCampaigns(await siteOrigin(), new Date());
  return NextResponse.json({ ok: true, ...r });
}
