// A-CSL-010 상담 콘솔 · F-ADM-CSL-01~10·13~16 (03 §4.3 레이아웃: ①고객 ②상담 유형 탭 ③거점 현황 ④Time Table ⑤이력 탭)
import { branch } from '@aircon/db';
import { hasPermission } from '@aircon/domain';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { activeScripts } from '@/server/consult';
import { getDb } from '@/server/db';
import { loadQuoteChoices } from '@/server/quote';
import { ConsoleScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function ConsolePage() {
  const admin = await requireScreen('A-CSL-010');
  const filter = await currentBranchFilter(admin);
  const [choices, codes, scripts, branches] = await Promise.all([
    loadQuoteChoices(null, { anyBranch: true }),
    loadCodes([
      'DEVICE_TYPE',
      'CLEAN_LEVEL',
      'HOUSING_TYPE',
      'ORDER_TYPE',
      'ORDER_SYMPTOM',
      'INQUIRY_SUB_TYPE',
      'CONSULT_TYPE',
      'CONSULT_STATUS',
      'CUSTOMER_GRADE',
      'CUSTOMER_TAG',
      'CUSTOMER_TYPE',
      'PRIVACY_AGREE_STATUS',
      'VISIT_TYPE',
      'TECH_GRADE',
      'SCHEDULE_TYPE',
      'BRAND',
      'JOIN_CHANNEL',
      'ORDER_CHANNEL',
      'PENDING_REASON',
    ]),
    activeScripts(),
    getDb()
      .select({ id: branch.id, name: branch.name })
      .from(branch)
      .where(and(eq(branch.status, 'ACTIVE'), isNull(branch.deletedAt)))
      .orderBy(asc(branch.name)),
  ]);
  const visibleBranches = filter.kind === 'ALL' ? branches : filter.kind === 'BRANCH' ? branches.filter((b) => b.id === filter.branchId) : [];
  return (
    <ConsoleScreen
      choices={choices}
      codes={codes}
      scripts={scripts}
      branches={visibleBranches}
      canWrite={!admin.preview && hasPermission(admin, 'A-CSL-010', 'CREATE')}
      canUpdate={!admin.preview && hasPermission(admin, 'A-CSL-010', 'UPDATE')}
      readOnly={admin.preview}
    />
  );
}
