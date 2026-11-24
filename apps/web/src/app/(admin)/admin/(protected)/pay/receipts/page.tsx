// A-PAY-050 증빙 · F-ADM-PAY-05: 현금영수증·세금계산서 신청 목록(상태별), 발행(현금영수증 = 발행 연동, 세금계산서 = 홈택스 발행 후 승인번호 입력)·취소.
// 번호는 마스킹, [보기]는 수정 권한자만·감사 로그(BR-100). B2B 월합산 계산서는 단계 11(거래처).
import { hasPermission } from '@aircon/domain';
import { listTaxDocs } from '@/server/payments';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { ReceiptsScreen } from './screen';

export const dynamic = 'force-dynamic';

const STATUSES = ['REQUESTED', 'ISSUED', 'FAILED', 'CANCELED'];

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const admin = await requireScreen('A-PAY-050');
  const sp = await searchParams;
  const status = sp.status && STATUSES.includes(sp.status) ? sp.status : null;
  const [rows, codes] = await Promise.all([
    listTaxDocs(await currentBranchFilter(admin), status),
    loadCodes(['TAX_DOC_TYPE', 'TAX_ISSUE_STATUS', 'PAYMENT_METHOD']),
  ]);
  return (
    <ReceiptsScreen
      rows={rows}
      status={status}
      codes={codes}
      canIssue={hasPermission(admin, 'A-PAY-050', 'UPDATE') && !admin.preview}
    />
  );
}
