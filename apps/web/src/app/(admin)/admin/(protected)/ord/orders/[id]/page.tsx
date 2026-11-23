// A-ORD-020 주문 상세 · F-ADM-ORD-02~04: 7개 탭 [기본 | 항목·금액 | 배정 | 작업결과·사진 | 결제 | 활동내역 | 상태이력], [수정][취소][재배정(단계 3)]
import { hasPermission } from '@aircon/domain';
import { notFound } from 'next/navigation';
import { RESCHEDULABLE_STATUSES, getOrderDetail } from '@/server/admin-orders';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { OrderDetailScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireScreen('A-ORD-020');
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const d = await getOrderDetail(id, await currentBranchFilter(admin));
  if (!d) notFound();
  const codes = await loadCodes([
    'ORDER_CHANNEL',
    'ORDER_TYPE',
    'VISIT_TYPE',
    'PAYMENT_STATUS',
    'PAYMENT_STAGE',
    'PAYMENT_METHOD',
    'PAYMENT_TX_STATUS',
    'REFUND_REASON',
    'REFUND_STATUS',
    'CANCEL_REASON',
    'CHANGE_REQUEST_TYPE',
    'CHANGE_REQUEST_STATUS',
    'ACTOR_TYPE',
    'HOUSING_TYPE',
    'QUOTE_ITEM_TYPE',
    'CUSTOMER_TYPE',
  ]);
  const canUpdate = hasPermission(admin, 'A-ORD-020', 'UPDATE') && !admin.preview;
  return (
    <OrderDetailScreen
      d={d}
      codes={codes}
      canUpdate={canUpdate}
      canReschedule={RESCHEDULABLE_STATUSES.includes(d.order.status)}
    />
  );
}
