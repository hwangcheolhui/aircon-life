// A-STA-010 매출 통계 · F-ADM-STA-01: 기간·단위(일/주/월)·기준(거점/상품/채널/고객유형), 기간별 매출·환불·순매출, 성수기/비수기, CSV 다운로드(EXPORT + 감사 로그)
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { salesStats } from '@/server/ops';
import { salesQueryOf } from './query';
import { SalesScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireScreen('A-STA-010');
  const q = salesQueryOf(await searchParams);
  const [data, codes] = await Promise.all([salesStats(await currentBranchFilter(admin), q), loadCodes(['ORDER_CHANNEL', 'CUSTOMER_TYPE'])]);
  return <SalesScreen data={data} query={q} codes={codes} canExport={hasPermission(admin, 'A-STA-010', 'EXPORT')} />;
}
