// A-DSP-060 기사 관할 구역 지정 · F-ADM-DSP-08: 거점 서비스 지역 위에 기사별 주/보조 관할 구역을 지도로 지정하고,
// 주 관할이 없는 동(빈 곳)·겹치는 동을 표시한다. BR-102 거점 범위. 지도는 모의 지도(카카오맵 실연동은 지도 어댑터 교체).
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { boardBranches } from '@/server/dispatch';
import { loadZoneBoard } from '@/server/zones';
import { ZonesScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function ZonesPage({
  searchParams,
}: {
  searchParams: Promise<{ branchId?: string; techId?: string }>;
}) {
  const admin = await requireScreen('A-DSP-060');
  const filter = await currentBranchFilter(admin); // BR-102
  const sp = await searchParams;
  const branches = await boardBranches(filter);
  const branchId = branches.find((b) => String(b.id) === sp.branchId)?.id ?? branches[0]?.id ?? null;
  const [board, codes] = await Promise.all([
    branchId ? loadZoneBoard(branchId, filter) : Promise.resolve(null),
    loadCodes(['ZONE_TYPE', 'ZONE_DEFINE_METHOD', 'TECH_GRADE']),
  ]);
  return (
    <ZonesScreen
      branches={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      branchId={branchId ? String(branchId) : ''}
      techId={sp.techId ?? ''}
      board={board}
      codes={codes}
      canUpdate={hasPermission(admin, 'A-DSP-060', 'UPDATE') && !admin.preview}
      canDelete={hasPermission(admin, 'A-DSP-060', 'DELETE') && !admin.preview}
    />
  );
}
