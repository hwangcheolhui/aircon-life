// A-STL-030 기사별 정산 검토·조정 · F-ADM-STL-03 (BR-082~084): 회차 선택 → 기사별 정산서(건수·매출·배분·추가·인센티브·공제·현장 수금·원천세·실지급),
// 행 더블클릭 = 정산서 상세(건별 항목·상태 이력·이의 내용), [조정 추가](인센티브·공제·조정, 사유), [이의 처리]. 확정된 정산은 수정 불가(다음 회차 조정).
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { adjustableTechs, getSettlementDetail, listBatches, listSettlements } from '@/server/settlements';
import { SettlementsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function SettlementsPage({ searchParams }: { searchParams: Promise<{ batchId?: string; id?: string }> }) {
  const admin = await requireScreen('A-STL-030');
  const filter = await currentBranchFilter(admin);
  const q = await searchParams;
  const batches = await listBatches(filter);
  const batchId = Number(q.batchId) || batches[0]?.id || null;
  const [list, detail, techs, codes] = await Promise.all([
    batchId ? listSettlements(batchId, filter).catch(() => null) : null,
    q.id ? getSettlementDetail(Number(q.id), filter).catch(() => null) : null,
    adjustableTechs(filter),
    loadCodes(['SETTLEMENT_BATCH_STATUS', 'SETTLEMENT_STATUS', 'SETTLEMENT_ITEM_TYPE', 'TECH_GRADE', 'CONTRACT_TYPE', 'ASSIGN_ROLE', 'ACTOR_TYPE']),
  ]);
  const live = !admin.preview;
  return (
    <SettlementsScreen
      batches={batches.map((b) => ({ value: String(b.id), label: `${b.batchNo} (${b.periodStart} ~ ${b.periodEnd})` }))}
      batch={list?.batch ?? null}
      rows={list?.rows ?? []}
      detail={detail && detail.batch.id === list?.batch.id ? detail : null}
      techs={techs.map((t) => ({ value: String(t.id), label: `${t.name} (${t.techCode})` }))}
      codes={codes}
      canAdjust={hasPermission(admin, 'A-STL-030', 'UPDATE') && live}
      canResolve={hasPermission(admin, 'A-STL-030', 'APPROVE') && live}
    />
  );
}
