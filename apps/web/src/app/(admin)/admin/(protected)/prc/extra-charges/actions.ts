'use server';
// A-PRC-040 추가요금 승인 서버 액션 · F-ADM-PRC-04 (BR-042): 승인 → 고객 동의 요청, 반려(사유 필수) → 기사 알림. BR-102 거점 범위.
import { extraChargeDecisionInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { decideExtraCharge } from '@/server/extra-charges';
import { extraAgreeUrl, siteOrigin } from '@/server/site-origin';

export async function decideExtra(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PRC-040', 'APPROVE');
    const v = parse(extraChargeDecisionInput, values);
    await decideExtraCharge(v, await currentBranchFilter(admin), admin.adminId, extraAgreeUrl(await siteOrigin()));
    revalidatePath('/admin/prc/extra-charges');
  });
}
