// A-DSP-020 재배정·이관 · F-ADM-DSP-04: [이관 요청] 기사가 보낸 이관 요청 승인(새 기사 지정)/반려 · [재배정] 접수번호로 주기사 변경(사유 필수)
// 자가 배정 요청 탭은 단계 4-2(F-TEC-OFF-02)에서 추가. BR-102 거점 범위.
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { listTransferRequests } from '@/server/dispatch';
import { TransfersScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function TransfersPage() {
  const admin = await requireScreen('A-DSP-020');
  const filter = await currentBranchFilter(admin);
  const [requests, codes] = await Promise.all([
    listTransferRequests(filter),
    loadCodes(['ASSIGN_ROLE', 'ASSIGN_STATUS', 'TECH_GRADE']),
  ]);
  return (
    <TransfersScreen
      requests={requests}
      codes={codes}
      canUpdate={hasPermission(admin, 'A-DSP-020', 'UPDATE') && !admin.preview}
    />
  );
}
