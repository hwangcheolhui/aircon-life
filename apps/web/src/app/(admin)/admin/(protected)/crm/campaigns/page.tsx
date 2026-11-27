// A-CRM-020 캠페인 관리 · F-ADM-CRM-02: 시즌·휴면·교차 판매 캠페인(대상 조건: 거점·기기 형태·주거 형태·최근 작업 경과 개월), 템플릿·쿠폰 동봉, 예약·즉시 발송, 성과(발송·전환).
// 상태 DRAFT → SCHEDULED → RUNNING → DONE, 중지 STOPPED (01 §3.16). 마케팅 수신 동의 고객만(BR-091·101). 예약 발송은 배치 /api/jobs/campaign-send
import { branch } from '@aircon/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { campaignTemplates, listCampaigns } from '@/server/campaigns';
import { loadCodes } from '@/server/codes';
import { listCoupons } from '@/server/coupons';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { CampaignsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  const admin = await requireScreen('A-CRM-020');
  const [rows, templates, coupons, codes, branches] = await Promise.all([
    listCampaigns(),
    campaignTemplates(),
    listCoupons(),
    loadCodes(['CAMPAIGN_TYPE', 'CAMPAIGN_STATUS', 'DEVICE_TYPE', 'HOUSING_TYPE']),
    getDb().select({ id: branch.id, name: branch.name }).from(branch).where(and(eq(branch.status, 'ACTIVE'), isNull(branch.deletedAt))).orderBy(asc(branch.name)),
  ]);
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const flags = screenFlags(admin, 'A-CRM-020');
  return (
    <CampaignsScreen
      rows={rows}
      templates={templates.map((t) => ({ value: String(t.id), label: t.title }))}
      coupons={coupons.filter((c) => c.isActive && c.validTo >= today).map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` }))}
      codes={{ ...codes, CAMPAIGN_TYPE: (codes.CAMPAIGN_TYPE ?? []).filter((o) => o.value !== 'REVISIT_AUTO') }}
      branches={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      canEdit={!admin.preview && flags.canUpdate}
    />
  );
}
