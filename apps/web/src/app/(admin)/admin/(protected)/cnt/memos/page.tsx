// A-CNT-040 메모·지정 메모 발송 · F-ADM-CNT-04: 기사를 골라 메모(머리말·내용·기간·반복·팝업) 발송, 보낸 메모의 수신·확인 인원
// 기사 앱 T-HOM-010 오늘의 메모(우선순위 거점장 > 관리자 > 본인)·T-CAL-010 메모 모드·T-MEMO-020 팝업에 보인다
import { kstDate } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { listAssignedMemos, memoTargetTechs } from '@/server/tech-memos';
import { resolveBranchFilter } from '@aircon/domain';
import { AssignedMemosScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function AssignedMemosPage() {
  const admin = await requireScreen('A-CNT-040');
  const [rows, techs, codes] = await Promise.all([
    listAssignedMemos(await currentBranchFilter(admin)),
    memoTargetTechs(resolveBranchFilter(admin, null)),
    loadCodes(['MEMO_HEADER', 'MEMO_REPEAT', 'MEMO_PRIORITY_SOURCE', 'TECH_STATUS']),
  ]);
  const flags = screenFlags(admin, 'A-CNT-040');
  const live = !admin.preview;
  return (
    <AssignedMemosScreen
      rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) }))}
      techs={techs.map((t) => ({ id: t.id, name: t.name, status: t.status }))}
      codes={codes}
      today={kstDate(new Date())}
      canCreate={live && flags.canCreate}
      canDelete={live && flags.canDelete}
    />
  );
}
