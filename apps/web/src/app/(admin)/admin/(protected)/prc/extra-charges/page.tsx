// A-PRC-040 추가요금(별도금액) 승인 · F-ADM-PRC-04 (BR-042): 기사가 등록한 기타(ETC) 추가요금(유형·제목·금액·기사·사유·증빙) 승인/반려.
// 승인하면 고객에게 동의 요청(C-ORD-040)이 가고, 반려하면 청구되지 않는다. 거점 범위(BR-102).
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { listExtraApprovals } from '@/server/extra-charges';
import { ExtraApprovalScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function ExtraChargesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const admin = await requireScreen('A-PRC-040');
  const filter = await currentBranchFilter(admin);
  const tab = (await searchParams).tab === 'done' ? 'DONE' : 'REQUESTED';
  const rows = await listExtraApprovals(filter, tab);
  return <ExtraApprovalScreen rows={rows} tab={tab} canApprove={hasPermission(admin, 'A-PRC-040', 'APPROVE') && !admin.preview} />;
}
