'use server';
// A-CUS-030 파기 대상 관리 서버 액션 · F-ADM-CUS-05: 일괄 파기 승인(슈퍼관리자 APPROVE). 파기 1건마다 감사 로그(BR-100)
import { purgeApproveInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { purgeCustomers } from '@/server/purge';

export async function approvePurge(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-CUS-030', 'APPROVE');
    const v = parse(purgeApproveInput, values);
    const n = await purgeCustomers(v.customerIds, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/cus/purge');
    return { purged: n };
  });
}
