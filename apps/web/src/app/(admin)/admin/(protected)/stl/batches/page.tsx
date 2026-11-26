// A-STL-020 정산 회차 · F-ADM-STL-02·04 (BR-080~084): 회차 목록, [회차 생성](월~일 주 단위·거점), [계산](DRAFT → CALCULATED, 기사 확인 요청 알림),
// [확정](이의 없을 때, 이후 수정 불가 BR-084), [지급 파일](은행 대량이체 CSV, 감사 로그), [지급 완료](기사 알림), [마감]. 그리드 더블클릭 = 기사별 정산(A-STL-030).
import { hasPermission, kstDate, previousWeek } from '@aircon/domain';
import { branch } from '@aircon/db';
import { asc, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { getDb } from '@/server/db';
import { listBatches } from '@/server/settlements';
import { BatchesScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function SettlementBatchesPage() {
  const admin = await requireScreen('A-STL-020');
  const filter = await currentBranchFilter(admin);
  const [rows, branches, codes] = await Promise.all([
    listBatches(filter),
    getDb().select({ id: branch.id, name: branch.name }).from(branch).where(isNull(branch.deletedAt)).orderBy(asc(branch.name)),
    loadCodes(['SETTLEMENT_BATCH_STATUS']),
  ]);
  const live = !admin.preview;
  return (
    <BatchesScreen
      rows={rows}
      codes={codes}
      branches={filter.kind === 'BRANCH' ? [] : branches.map((b) => ({ value: String(b.id), label: b.name }))}
      lastWeekStart={previousWeek(kstDate(new Date())).periodStart}
      canCreate={hasPermission(admin, 'A-STL-020', 'CREATE') && live}
      canCalc={hasPermission(admin, 'A-STL-020', 'UPDATE') && live}
      canApprove={hasPermission(admin, 'A-STL-020', 'APPROVE') && live}
      canExport={hasPermission(admin, 'A-STL-020', 'EXPORT') && live}
    />
  );
}
