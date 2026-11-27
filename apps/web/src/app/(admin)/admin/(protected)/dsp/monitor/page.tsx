// A-DSP-070 코스 모니터링 지도 · F-ADM-DSP-09: 기사별 확정 코스·정류장 진행(예정·안내·예상 도착·실제), 지연(ETA_DELAY_ALERT_MIN 이상) 표시, 최근 위치(오늘만, BR-115 관리자 한정),
// 기사의 코스 변경 요청 승인·반려(승인하면 그 코스를 다시 고칠 수 있다). 거점 범위(BR-102).
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { monitorBoard } from '@/server/route-monitor';
import { MonitorScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function MonitorPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const admin = await requireScreen('A-DSP-070');
  const sp = await searchParams;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const [plans, codes] = await Promise.all([monitorBoard(await currentBranchFilter(admin), date), loadCodes(['ROUTE_STATUS', 'STOP_STATUS', 'ROUTE_CHANGE_STATUS'])]);
  return <MonitorScreen plans={plans} codes={codes} date={date} canDecide={!admin.preview && hasPermission(admin, 'A-DSP-070', 'UPDATE')} />;
}
