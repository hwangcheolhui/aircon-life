'use server';
// A-ORD-030 변경·취소 요청 처리 · F-ADM-ORD-05 (승인 시 일정 이동·슬롯 재배치 BR-021, 변경 알림)
import { changeRequestHandleInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handleChangeRequest } from '@/server/admin-orders';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';

export async function decideRequest(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-ORD-030', 'UPDATE');
    const v = parse(changeRequestHandleInput, values);
    await handleChangeRequest(v.requestId, v.decision, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/ord/requests');
  });
}
