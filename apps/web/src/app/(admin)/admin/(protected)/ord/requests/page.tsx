// A-ORD-030 변경·취소 요청 · F-ADM-ORD-05: 고객 앱 요청 목록, 승인/반려 (거점 범위 BR-102, 고객명 마스킹 BR-100)
import { hasPermission } from '@aircon/domain';
import { listChangeRequests } from '@/server/admin-orders';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { RequestsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const admin = await requireScreen('A-ORD-030');
  const raw = (await searchParams).status;
  const status = raw === 'ALL' ? null : (raw ?? 'REQUESTED');
  const [rows, codes] = await Promise.all([
    listChangeRequests(await currentBranchFilter(admin), status),
    loadCodes(['CHANGE_REQUEST_TYPE', 'CHANGE_REQUEST_STATUS']),
  ]);
  return <RequestsScreen rows={rows} status={raw ?? 'REQUESTED'} codes={codes} canUpdate={hasPermission(admin, 'A-ORD-030', 'UPDATE') && !admin.preview} />;
}
