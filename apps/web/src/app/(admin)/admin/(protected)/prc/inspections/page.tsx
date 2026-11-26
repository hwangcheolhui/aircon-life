// A-PRC-030 작업 결과 검수 · F-ADM-PRC-03: 작업완료 건의 사진·결과·작업시간을 보고 승인 또는 반려(재작업). 반려 건은 정산에서 빠진다.
// INSPECTION_REQUIRED=Y 면 승인 건만 정산 대상(F-SYS-08). 거점 범위(BR-102).
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { listInspections } from '@/server/inspections';
import { InspectionScreen } from './screen';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function InspectionsPage({ searchParams }: { searchParams: Promise<{ status?: string; from?: string; to?: string }> }) {
  const admin = await requireScreen('A-PRC-030');
  const sp = await searchParams;
  const status = sp.status === 'ALL' ? null : ['WAITING', 'APPROVED', 'REJECTED'].includes(sp.status ?? '') ? sp.status! : 'WAITING';
  const q = { status, from: sp.from && DATE.test(sp.from) ? sp.from : null, to: sp.to && DATE.test(sp.to) ? sp.to : null };
  const [rows, codes] = await Promise.all([listInspections(await currentBranchFilter(admin), q), loadCodes(['INSPECTION_STATUS', 'PHOTO_TYPE', 'WORK_RESULT'])]);
  return <InspectionScreen rows={rows} codes={codes} q={{ status: status ?? 'ALL', from: q.from ?? '', to: q.to ?? '' }} canApprove={!admin.preview && hasPermission(admin, 'A-PRC-030', 'UPDATE')} />;
}
