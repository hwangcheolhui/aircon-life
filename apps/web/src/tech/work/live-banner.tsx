// 기사 앱 "진행 중 작업" 고정 배너 (03 §3.1·§6.2, 05 .ac-live-banner): 출발~작업중인 작업이 있으면 모든 화면 상단에 [이어서]
import Link from 'next/link';
import { activeWorkOf } from '@/server/work';
import { OfflineBadge } from './offline-badge';

const LABEL: Record<string, string> = { ON_THE_WAY: '이동중', ARRIVED: '도착', IN_PROGRESS: '작업중' };
const NEXT: Record<string, string> = { ON_THE_WAY: '', ARRIVED: '/safety', IN_PROGRESS: '/photos' };

export async function LiveWorkBanner({ techId }: { techId: number }) {
  const w = await activeWorkOf(techId);
  if (!w) return null;
  return (
    <div className="ac-live-banner" role="status">
      <span>
        진행 중 작업 <strong className="ac-num">{w.orderNo}</strong> · {LABEL[w.status] ?? w.status}
      </span>
      <OfflineBadge />
      <Link href={`/tech/jobs/${w.orderNo}/work${NEXT[w.status] ?? ''}`} className="ac-btn ac-btn--sm ac-btn--secondary">
        이어서
      </Link>
    </div>
  );
}
