'use server';
// A-PRC-030 작업 결과 검수 서버 액션 · F-ADM-PRC-03: 승인·반려(사유 필수, 주기사 알림). BR-102 거점 범위.
import { inspectionInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { inspectWork } from '@/server/inspections';

export async function inspectAction(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PRC-030', 'UPDATE');
    const v = parse(inspectionInput, values);
    await inspectWork(v, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/prc/inspections');
  });
}
