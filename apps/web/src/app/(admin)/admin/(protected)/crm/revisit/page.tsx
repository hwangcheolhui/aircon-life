// A-CRM-010 재방문 자동 캠페인 · F-ADM-CRM-01: 자동 규칙(최근 작업 후 REVISIT_MONTHS개월·마케팅 동의 BR-091·101, 대상 거점), 오늘 대상 미리보기, 발송·전환 성과. 쿠폰 첨부는 단계 9
import { branch } from '@aircon/db';
import { hasPermission } from '@aircon/domain';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { revisitOverview } from '@/server/crm';
import { getDb } from '@/server/db';
import { RevisitScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function RevisitPage() {
  const admin = await requireScreen('A-CRM-010');
  const [d, codes, branches] = await Promise.all([
    revisitOverview(await currentBranchFilter(admin)),
    loadCodes(['CAMPAIGN_TARGET_STATUS']),
    getDb().select({ id: branch.id, name: branch.name }).from(branch).where(and(eq(branch.status, 'ACTIVE'), isNull(branch.deletedAt))).orderBy(asc(branch.name)),
  ]);
  return <RevisitScreen d={d} codes={codes} branches={branches} canUpdate={!admin.preview && hasPermission(admin, 'A-CRM-010', 'UPDATE')} />;
}
