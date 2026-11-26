// A-STA-040 고객·CRM 통계 (단계 9) · F-ADM-STA-04: 신규/재방문, 재방문율, 캠페인 전환율, 지역·주거유형 분포
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { customerStats } from '@/server/stats';
import { periodOf } from '../period';
import { CustomerStatsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function CustomerStatsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireScreen('A-STA-040');
  const q = periodOf(await searchParams);
  const [data, codes] = await Promise.all([customerStats(await currentBranchFilter(admin), q), loadCodes(['HOUSING_TYPE', 'CAMPAIGN_TYPE'])]);
  return <CustomerStatsScreen data={data} query={q} codes={codes} />;
}
