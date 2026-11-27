'use server';
// A-VOC-040 후기 관리 서버 액션 · F-ADM-VOC-04: 답글·숨김. BR-102 거점 범위.
import { reviewAdminInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { updateReviewAdmin } from '@/server/reviews';

export async function saveReviewAction(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-VOC-040', 'UPDATE');
    const v = parse(reviewAdminInput, values);
    await updateReviewAdmin(v, await currentBranchFilter(admin), admin.adminId);
    revalidatePath('/admin/voc/reviews');
  });
}
