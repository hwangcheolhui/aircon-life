// A-PAY-010 결제 내역 · F-ADM-PAY-01: 기간·수단·상태·접수번호(거점은 상단 선택, BR-102) 조회, PG 대사(승인 결제를 PG 서버에 다시 확인)
import { listPayments } from '@/server/payments';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { periodOf } from '../query';
import { PaymentsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const admin = await requireScreen('A-PAY-010');
  const sp = await searchParams;
  const q = {
    ...periodOf(sp, 7),
    method: sp.method || null,
    status: sp.status || null,
    orderNo: sp.orderNo?.trim() || null,
  };
  const [rows, codes] = await Promise.all([
    listPayments(await currentBranchFilter(admin), q),
    loadCodes(['PAYMENT_METHOD', 'PAYMENT_TX_STATUS', 'PAYMENT_STAGE']),
  ]);
  return <PaymentsScreen rows={rows} query={q} codes={codes} mode="all" canResend={false} />;
}
