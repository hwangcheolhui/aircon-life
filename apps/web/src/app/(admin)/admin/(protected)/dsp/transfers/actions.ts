'use server';
// A-DSP-020 재배정·이관·자가 배정 요청 서버 액션 · F-ADM-DSP-04(재배정·이관 승인/반려) · F-ADM-DSP-10(자가 배정 승인/거절, 단계 4-2). 사유 필수, 이력 assignment_history INSERT ONLY. BR-102 거점 범위.
import { reassignInput, selfAssignDecisionInput, transferDecisionInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { MSG } from '@aircon/domain';
import { UserError, handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { decideSelfAssign } from '@/server/self-assign';
import { branchTechOptions, decideTransfer, findOrderForReassign, reassignOrder } from '@/server/dispatch';

const MENU = 'A-DSP-020';

const refresh = () => {
  revalidatePath('/admin/dsp/transfers');
  revalidatePath('/admin/dsp/board');
};

/** 접수번호로 재배정할 주문 찾기 (+ 그 거점 기사 선택지) */
export async function findOrder(orderNo: string) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    if (!orderNo.trim()) throw new UserError(MSG.required('접수번호'));
    const o = await findOrderForReassign(orderNo, await currentBranchFilter(admin));
    if (!o) throw new UserError('조회 결과가 없습니다.');
    return { order: o, techs: await branchTechOptions(o.branchId) };
  });
}

/** 이관 요청 승인 화면의 기사 선택지 */
export async function techOptions(branchId: number) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    const f = await currentBranchFilter(admin);
    if (f.kind === 'NONE' || (f.kind === 'BRANCH' && f.branchId !== branchId))
      throw new UserError('다른 거점의 기사는 볼 수 없습니다.');
    return branchTechOptions(branchId);
  });
}

export async function reassign(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const v = parse(reassignInput, values);
    const r = await reassignOrder(v, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    if (r.saved) refresh();
    return r;
  });
}

export async function decide(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const v = parse(transferDecisionInput, values);
    const r = await decideTransfer(v, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    if (r.saved) refresh();
    return r;
  });
}

/** F-ADM-DSP-10 자가 배정 요청 승인/거절 (BR-111, 거절 사유 필수) */
export async function decideSelf(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const v = parse(selfAssignDecisionInput, values);
    await decideSelfAssign(v, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    refresh();
  });
}
