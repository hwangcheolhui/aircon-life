'use server';
// A-PRC-060 독촉·전달 현황 서버 액션 (F-ADM-PRC-08): 종결. 첫 줄 requirePermission, 거점 범위 currentBranchFilter(BR-102)
import { followupCloseInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { closeFollowup } from '@/server/followups';

export async function closeFollowupAction(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PRC-060', 'UPDATE');
    const v = parse(followupCloseInput, values);
    await closeFollowup(v.id, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/prc/followups');
  });
}
