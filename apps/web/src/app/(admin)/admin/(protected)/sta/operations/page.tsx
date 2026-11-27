// A-STA-020 운영 통계 (단계 9) · F-ADM-STA-02: 처리 건수, 기기 유형별 평균 작업시간, 미처리율, 취소율, 슬롯 가동률
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { opsStats } from '@/server/stats';
import { periodOf } from '../period';
import { OpsStatsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function OpsStatsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireScreen('A-STA-020');
  const q = periodOf(await searchParams);
  const [data, codes] = await Promise.all([opsStats(await currentBranchFilter(admin), q), loadCodes(['DEVICE_TYPE'])]);
  return <OpsStatsScreen data={data} query={q} codes={codes} />;
}
