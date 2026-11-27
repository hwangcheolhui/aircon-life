'use server';
// A-CNT-040 메모·지정 메모 발송 서버 액션 · F-ADM-CNT-04: 기사 지정 메모 발송(수신자 N명, 앱 알림 TECH_MEMO_ASSIGNED)·취소
// 수신 기사는 역할 거점 범위 안에서만(BR-102). 우선순위 출처는 역할로 정한다(거점장 = BRANCH_MANAGER, 그 외 = ADMIN)
import { assignedMemoInput, z } from '@aircon/contracts';
import { resolveBranchFilter } from '@aircon/domain';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { deleteAssignedMemo, sendAssignedMemo } from '@/server/tech-memos';

export async function sendAssignedMemoAction(values: Record<string, string>, technicianIds: string[]) {
  return handle(async () => {
    const admin = await requirePermission('A-CNT-040', 'CREATE');
    const v = parse(assignedMemoInput, { ...values, technicianIds });
    const r = await sendAssignedMemo(v, admin, resolveBranchFilter(admin, null));
    revalidatePath('/admin/cnt/memos');
    return r;
  });
}

export async function deleteAssignedMemoAction(id: number) {
  return handle(async () => {
    const admin = await requirePermission('A-CNT-040', 'DELETE');
    await deleteAssignedMemo(parse(z.coerce.number().int().positive(), id), admin, resolveBranchFilter(admin, null));
    revalidatePath('/admin/cnt/memos');
  });
}
