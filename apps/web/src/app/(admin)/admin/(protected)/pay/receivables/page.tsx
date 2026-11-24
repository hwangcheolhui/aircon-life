// A-PAY-040 미수금 · F-ADM-PAY-04 (BR-081): 작업완료인데 결제를 못 받아 미수(RECEIVABLE)로 남은 주문 목록, [미수금] 메모, 결제 링크, 입금 확인.
// 미수 주문은 결제가 끝날 때까지 정산에서 빠지고, 입금 확인으로 전액이 되면 주문이 완료되어 정산 대상이 된다.
import { hasPermission } from '@aircon/domain';
import { listReceivables } from '@/server/payments';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { ReceivablesScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function ReceivablesPage() {
  const admin = await requireScreen('A-PAY-040');
  const [rows, codes] = await Promise.all([
    listReceivables(await currentBranchFilter(admin)),
    loadCodes(['PAYMENT_METHOD']),
  ]);
  const live = !admin.preview;
  return (
    <ReceivablesScreen
      rows={rows}
      codes={codes}
      canMemo={hasPermission(admin, 'A-PAY-040', 'CREATE') && live}
      canCollect={hasPermission(admin, 'A-PAY-040', 'UPDATE') && live}
    />
  );
}
