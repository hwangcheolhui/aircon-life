// A-TEC-030 지원자 관리 · F-ADM-TEC-04: 상시 모집 지원서(거점·연령대·지역·경력·자격·유입 경로·지원 대상), 상태 지원 → 면접 → 합격/불합격
// 합격하면 기사 계정(교육중·견습)이 만들어지고 합격 안내(APPLICANT_ACCEPTED 알림톡, 실패 시 문자)가 나간다. 목록 연락처는 마스킹(BR-100)
import { branch } from '@aircon/db';
import { resolveBranchFilter } from '@aircon/domain';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { listApplications } from '@/server/training';
import { ApplicantsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function ApplicantsPage() {
  const admin = await requireScreen('A-TEC-030');
  const scope = resolveBranchFilter(admin, null);
  const [rows, codes, branches] = await Promise.all([
    listApplications(await currentBranchFilter(admin)),
    loadCodes(['APPLICATION_STATUS', 'APPLICATION_SOURCE', 'AGE_GROUP', 'CONTRACT_TYPE']),
    getDb().select({ id: branch.id, name: branch.name }).from(branch).where(and(eq(branch.status, 'ACTIVE'), isNull(branch.deletedAt))).orderBy(asc(branch.name)),
  ]);
  const writable = scope.kind === 'ALL' ? branches : scope.kind === 'BRANCH' ? branches.filter((b) => b.id === scope.branchId) : [];
  const flags = screenFlags(admin, 'A-TEC-030');
  const live = !admin.preview;
  return (
    <ApplicantsScreen
      rows={rows}
      codes={codes}
      branches={writable.map((b) => ({ value: String(b.id), label: b.name }))}
      canCreate={live && flags.canCreate}
      canUpdate={live && flags.canUpdate}
      canDelete={live && flags.canDelete}
    />
  );
}
