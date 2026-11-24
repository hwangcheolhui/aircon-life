'use server';
// 정산 서버 액션 (단계 7): A-STL-010 수수료 정책 F-ADM-STL-01 · A-STL-020 회차 생성·계산·확정·지급 완료·마감 F-ADM-STL-02·04 ·
// A-STL-030 조정 추가·이의 처리 F-ADM-STL-03 (BR-080~084). 모든 액션 첫 줄에서 requirePermission(화면 ID, 행위), 거점 범위는 currentBranchFilter(BR-102).
import {
  commissionPolicyInput,
  settlementAdjustInput,
  settlementBatchActionInput,
  settlementBatchInput,
  settlementResolveInput,
} from '@aircon/contracts';
import { commissionPolicy } from '@aircon/db';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { deleteRow, saveRow } from '@/server/crud';
import {
  addAdjustment,
  calculateBatch,
  checkPolicyInput,
  closeBatch,
  confirmBatch,
  createBatch,
  markBatchPaid,
  resolveDispute,
  transferSummary,
} from '@/server/settlements';

const policyCfg = {
  menu: 'A-STL-010',
  table: commissionPolicy,
  idColumn: commissionPolicy.id,
  schema: commissionPolicyInput,
  softDelete: true,
  path: '/admin/stl/policies',
  check: async (data: Parameters<typeof checkPolicyInput>[0], admin: Parameters<typeof currentBranchFilter>[0]) =>
    checkPolicyInput(data, await currentBranchFilter(admin)),
};

/** F-ADM-STL-01 정책 저장 */
export async function savePolicy(values: Record<string, string>, id: string | null) {
  return saveRow(policyCfg, values, id);
}
/** F-ADM-STL-01 정책 삭제(소프트 삭제 — 지난 정산의 근거로 남는다) */
export async function deletePolicy(id: string) {
  return deleteRow(policyCfg, id);
}

/** F-ADM-STL-02 [회차 생성] */
export async function saveBatch(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-STL-020', 'CREATE');
    const v = parse(settlementBatchInput, values);
    const r = await createBatch(v, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/stl', 'layout');
    return r;
  });
}

/** F-ADM-STL-02 [계산] · F-ADM-STL-04 [확정]·[지급 완료]·[마감] */
export async function actBatch(values: Record<string, unknown>) {
  const v = settlementBatchActionInput.safeParse(values);
  const action = v.success ? v.data.action : 'CALCULATE';
  return handle(async () => {
    const admin = await requirePermission('A-STL-020', action === 'CALCULATE' ? 'UPDATE' : 'APPROVE');
    const p = parse(settlementBatchActionInput, values);
    const filter = await currentBranchFilter(admin);
    const actor = { type: 'ADMIN' as const, id: admin.adminId };
    let data: unknown = null;
    if (p.action === 'CALCULATE') data = await calculateBatch(p.batchId, filter, actor);
    else if (p.action === 'CONFIRM') await confirmBatch(p.batchId, filter, actor);
    else if (p.action === 'PAID') await markBatchPaid(p.batchId, p.transferRef, filter, actor);
    else await closeBatch(p.batchId, filter, actor);
    revalidatePath('/admin/stl', 'layout');
    return data;
  });
}

/** F-ADM-STL-03 조정 추가 (인센티브·공제·조정, 사유 필수, BR-084) */
export async function saveAdjustment(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-STL-030', 'UPDATE');
    const v = parse(settlementAdjustInput, values);
    const r = await addAdjustment(v, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/stl', 'layout');
    return r;
  });
}

/** F-ADM-STL-03 이의 처리 (DISPUTED → CONFIRMED) */
export async function saveDisputeResolve(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-STL-030', 'APPROVE');
    const v = parse(settlementResolveInput, values);
    await resolveDispute(v.settlementId, v.note, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/stl', 'layout');
  });
}

/** [지급 완료] 창의 요약: 이체 건수·합계, 계좌 없는 기사, 이체 없는 기사(계좌 원문은 다루지 않음) */
export async function loadTransferSummary(batchId: number) {
  return handle(async () => {
    const admin = await requirePermission('A-STL-020', 'READ');
    return transferSummary(parse(settlementBatchActionInput.shape.batchId, batchId), await currentBranchFilter(admin));
  });
}
