// A-PAY-020 결제 실패 · F-ADM-PAY-02: 실패한 결제 시도(사유)를 기간별로 보고, 아직 낼 돈이 있는 주문에 결제 링크를 다시 보낸다
import { hasPermission } from '@aircon/domain';
import { listPayments } from '@/server/payments';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { PaymentsScreen } from '../payments/screen';
import { periodOf } from '../query';

export const dynamic = 'force-dynamic';

export default async function PaymentFailuresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const admin = await requireScreen('A-PAY-020');
  const sp = await searchParams;
  const q = {
    ...periodOf(sp, 30),
    method: sp.method || null,
    status: 'FAILED',
    orderNo: sp.orderNo?.trim() || null,
  };
  const [rows, codes] = await Promise.all([
    listPayments(await currentBranchFilter(admin), q),
    loadCodes(['PAYMENT_METHOD', 'PAYMENT_TX_STATUS', 'PAYMENT_STAGE']),
  ]);
  return (
    <PaymentsScreen
      rows={rows}
      query={q}
      codes={codes}
      mode="failed"
      canResend={hasPermission(admin, 'A-PAY-020', 'UPDATE') && !admin.preview}
    />
  );
}
