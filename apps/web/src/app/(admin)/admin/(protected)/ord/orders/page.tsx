// A-ORD-010 주문 목록 · F-ADM-ORD-01: 방문일·상태·채널·검색어(접수번호·고객번호·전화번호) 조회, 목록 마스킹(BR-100), 거점 범위(BR-102), CSV 다운로드(EXPORT + 감사 로그)
import { hasPermission } from '@aircon/domain';
import { listOrders } from '@/server/admin-orders';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { parseOrderQuery } from './query';
import { OrdersScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireScreen('A-ORD-010');
  const sp = await searchParams;
  const q = parseOrderQuery(sp);
  const [rows, codes] = await Promise.all([
    listOrders(await currentBranchFilter(admin), q),
    loadCodes(['ORDER_STATUS', 'ORDER_CHANNEL', 'PAYMENT_STATUS']),
  ]);
  return (
    <OrdersScreen
      rows={rows}
      query={sp}
      codes={codes}
      canExport={hasPermission(admin, 'A-ORD-010', 'EXPORT') && !admin.preview}
      canCreate={hasPermission(admin, 'A-ORD-040', 'CREATE')}
    />
  );
}
