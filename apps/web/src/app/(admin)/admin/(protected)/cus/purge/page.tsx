// A-CUS-030 파기 대상 관리 · F-ADM-CUS-05: 파기 예정일(보관 PURGE_YEARS년 경과)이 지난 고객 목록, 선택 일괄 승인 → 비식별화(ERD §6). 자동 파기 여부는 PURGE_APPROVAL_MODE
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { listPurgeTargets, purgeMode } from '@/server/purge';
import { PurgeScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function PurgePage() {
  const admin = await requireScreen('A-CUS-030');
  const [rows, mode, codes] = await Promise.all([listPurgeTargets(await currentBranchFilter(admin)), purgeMode(), loadCodes(['CUSTOMER_STATUS'])]);
  return <PurgeScreen rows={rows} mode={mode} codes={codes} canApprove={!admin.preview && hasPermission(admin, 'A-CUS-030', 'APPROVE')} />;
}
