// A-PAY-030 환불 처리 · F-ADM-PAY-03: 환불 내역(기간) + [환불 등록](접수번호 → 결제 선택 → 전체/부분 금액·취소 수수료·사유).
// PG 결제는 PG 취소 연동, 현장 결제(현금·계좌·카드단말)는 직접 돌려준 뒤 기록만 남긴다. refund 는 INSERT ONLY.
import { hasPermission } from '@aircon/domain';
import { listRefunds } from '@/server/payments';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { periodOf } from '../query';
import { RefundsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const admin = await requireScreen('A-PAY-030');
  const q = periodOf(await searchParams, 30);
  const [rows, codes] = await Promise.all([
    listRefunds(await currentBranchFilter(admin), q),
    loadCodes(['PAYMENT_METHOD', 'REFUND_REASON', 'REFUND_STATUS']),
  ]);
  return (
    <RefundsScreen
      rows={rows}
      query={q}
      codes={codes}
      canCreate={hasPermission(admin, 'A-PAY-030', 'CREATE') && !admin.preview}
    />
  );
}
