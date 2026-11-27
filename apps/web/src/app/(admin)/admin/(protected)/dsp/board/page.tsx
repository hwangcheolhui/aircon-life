// A-DSP-010 배정 보드 · F-ADM-DSP-02(추천 기사 Top 3, 단계 9) · F-ADM-DSP-01(수동 배정, 끌어 놓기) · F-ADM-DSP-03(2인·동행 배정) · F-SYS-09(미지정 경고 표시) · 자가 배정 승인 대기 표시(F-ADM-DSP-10, 단계 4-2)
// 좌: 배정 대기 카드(약속 임박 미지정 강조) · 우: 기사 × 시간 간트. BR-102 거점 범위.
import { hasPermission, kstToday } from '@aircon/domain';
import { after } from 'next/server';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { BOARD_HOURS, alertUnassigned, boardBranches, loadBoard } from '@/server/dispatch';
import { BoardScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function DispatchBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ branchId?: string; date?: string }>;
}) {
  const admin = await requireScreen('A-DSP-010');
  const filter = await currentBranchFilter(admin); // BR-102
  const sp = await searchParams;
  // F-SYS-09: 15분 배치 대신(Vercel Hobby) 보드를 열 때도 임박 미지정 경고를 보낸다(건마다 1회)
  after(() => alertUnassigned().catch((e) => console.error('[unassigned-alert]', e)));
  const branches = await boardBranches(filter);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : kstToday(new Date());
  const branchId = branches.find((b) => String(b.id) === sp.branchId)?.id ?? branches[0]?.id ?? null;
  const [board, codes] = await Promise.all([
    branchId ? loadBoard(branchId, date) : Promise.resolve(null),
    loadCodes(['DEVICE_TYPE', 'TECH_GRADE', 'SKILL_LEVEL', 'ASSIGN_ROLE', 'ORDER_TYPE']),
  ]);
  return (
    <BoardScreen
      branches={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      branchId={branchId ? String(branchId) : ''}
      date={date}
      hours={BOARD_HOURS}
      board={board}
      codes={codes}
      canUpdate={hasPermission(admin, 'A-DSP-010', 'UPDATE') && !admin.preview}
    />
  );
}
