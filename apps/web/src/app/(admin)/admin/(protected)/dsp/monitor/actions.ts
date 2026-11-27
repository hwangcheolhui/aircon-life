'use server';
// A-DSP-070 코스 변경 요청 승인·반려 서버 액션 · F-ADM-DSP-09: 반려 사유 필수, 기사 앱 알림. BR-102 거점 범위.
import { routeChangeDecisionInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { decideRouteChange } from '@/server/route-monitor';

export async function decideRouteChangeAction(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-DSP-070', 'UPDATE');
    const v = parse(routeChangeDecisionInput, values);
    await decideRouteChange(v.planId, v.approve, v.note, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/dsp/monitor');
  });
}
