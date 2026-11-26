// A-CNT-010 공지사항 · F-ADM-CNT-01: 유형(전체·안전·거점·고객)·대상·게시 기간·상단 고정·팝업, 기사 읽음 현황. 기사 앱 T-HOM-010·T-NTC-010에 노출
import { branch } from '@aircon/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { resolveBranchFilter } from '@aircon/domain';
import { loadCodes } from '@/server/codes';
import { listNotices } from '@/server/content';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { NoticesScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function NoticesPage() {
  const admin = await requireScreen('A-CNT-010');
  const scope = resolveBranchFilter(admin, null);
  const [rows, codes, branches] = await Promise.all([
    listNotices(await currentBranchFilter(admin)),
    loadCodes(['NOTICE_TYPE', 'NOTICE_AUDIENCE']),
    getDb().select({ id: branch.id, name: branch.name }).from(branch).where(and(eq(branch.status, 'ACTIVE'), isNull(branch.deletedAt))).orderBy(asc(branch.name)),
  ]);
  const writable = scope.kind === 'ALL' ? branches : scope.kind === 'BRANCH' ? branches.filter((b) => b.id === scope.branchId) : [];
  const flags = screenFlags(admin, 'A-CNT-010');
  const live = !admin.preview;
  return (
    <NoticesScreen
      rows={rows}
      codes={codes}
      branches={writable.map((b) => ({ value: String(b.id), label: b.name }))}
      branchOnly={scope.kind !== 'ALL'}
      canCreate={live && flags.canCreate}
      canUpdate={live && flags.canUpdate}
      canDelete={live && flags.canDelete}
    />
  );
}
