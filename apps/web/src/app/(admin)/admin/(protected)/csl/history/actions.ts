'use server';
// A-CSL-070 상담 이력 · F-ADM-CSL-13: 미완료 상담(클레임 등) 완료 처리. 상태 전이는 01 §3.5(assertConsultTransition)를 따른다.
import { z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { completeConsultation } from '@/server/consult';

export async function completeConsult(id: number) {
  return handle(async () => {
    const admin = await requirePermission('A-CSL-070', 'UPDATE');
    const consultId = parse(z.coerce.number().int().min(1), id);
    await completeConsultation(consultId, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/csl/history');
  });
}
