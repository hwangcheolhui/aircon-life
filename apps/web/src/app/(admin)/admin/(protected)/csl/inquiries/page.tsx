// A-CSL-080 1:1 문의 관리 · F-CUS-CS-02 연계: 앱 문의 목록·답변(→ 고객 알림 INQUIRY_ANSWERED), VOC 전환, FAQ 전환(F-ADM-CNT-02)
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { listInquiries } from '@/server/inquiries';
import { InquiriesScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function InquiriesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const admin = await requireScreen('A-CSL-080');
  const sp = await searchParams;
  const status = sp.status === 'DONE' ? 'DONE' : sp.status === 'ALL' ? null : 'OPEN';
  const [rows, codes] = await Promise.all([listInquiries(await currentBranchFilter(admin), status), loadCodes(['INQUIRY_SUB_TYPE', 'CONSULT_STATUS'])]);
  const live = !admin.preview;
  return (
    <InquiriesScreen
      rows={rows}
      status={status ?? 'ALL'}
      codes={codes}
      canReply={live && hasPermission(admin, 'A-CSL-080', 'UPDATE')}
      canVoc={live && hasPermission(admin, 'A-VOC-010', 'CREATE')}
      canFaq={live && hasPermission(admin, 'A-CNT-020', 'CREATE')}
    />
  );
}
