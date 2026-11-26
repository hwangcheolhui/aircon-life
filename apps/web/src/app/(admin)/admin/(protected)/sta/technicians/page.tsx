// A-STA-030 기사 성과 (단계 9) · F-ADM-STA-03: 기사별 건수·매출·평점·VOC·AS율(BR-051 귀책)·작업시간
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { techStats } from '@/server/stats';
import { periodOf } from '../period';
import { TechStatsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function TechStatsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireScreen('A-STA-030');
  const q = periodOf(await searchParams);
  const rows = await techStats(await currentBranchFilter(admin), q);
  return <TechStatsScreen rows={rows} query={q} />;
}
