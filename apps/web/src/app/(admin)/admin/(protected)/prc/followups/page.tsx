// A-PRC-060 독촉·전달 현황 · F-ADM-PRC-08: 발송·읽음·회신 추적, 종결. 등록은 상담 콘솔 A-CSL-030
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { listFollowups } from '@/server/followups';
import { periodOf } from '../../pay/query';
import { FollowupsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function FollowupsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireScreen('A-PRC-060');
  const sp = await searchParams;
  const period = periodOf(sp, 14);
  const status = sp.status && /^[A-Z]+$/.test(sp.status) ? sp.status : null;
  const [rows, codes] = await Promise.all([
    listFollowups(await currentBranchFilter(admin), { status, dateFrom: period.from, dateTo: period.to }),
    loadCodes(['FOLLOWUP_STATUS', 'FOLLOWUP_TYPE', 'FOLLOWUP_CAUSE', 'FOLLOWUP_TARGET']),
  ]);
  return <FollowupsScreen rows={rows} query={{ ...period, status: status ?? '' }} codes={codes} canUpdate={!admin.preview && hasPermission(admin, 'A-PRC-060', 'UPDATE')} />;
}
