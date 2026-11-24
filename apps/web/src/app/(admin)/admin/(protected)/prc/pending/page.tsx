// A-PRC-050 미처리 대기열 · F-ADM-PRC-05 (BR-031·032): 미처리 사유별 탭, 경과 시간·장기 미처리(overdue48h) 강조,
// 재약속(PENDING → ASSIGNED: 같은 기사 배정을 새 일정으로 옮겨 배정 보드로 돌려보냄, 고객부재 2회 연속이면 운영자 확인)·취소. 거점 범위(BR-102).
import { hasPermission, kstDate } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { pendingQueue } from '@/server/process-console';
import { PendingQueueScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function PendingQueuePage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const admin = await requireScreen('A-PRC-050');
  const reason = (await searchParams).reason?.trim() || null;
  const [{ rows, counts }, codes] = await Promise.all([
    pendingQueue(await currentBranchFilter(admin), reason),
    loadCodes(['PENDING_REASON', 'CANCEL_REASON']),
  ]);
  return (
    <PendingQueueScreen
      rows={rows}
      counts={counts}
      reason={reason}
      codes={codes}
      today={kstDate(new Date())}
      canUpdate={hasPermission(admin, 'A-PRC-050', 'UPDATE') && !admin.preview}
    />
  );
}
