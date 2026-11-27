'use server';
// A-DSP-010 배정 보드 서버 액션 · F-ADM-DSP-01(수동 배정) · F-ADM-DSP-03(2인·동행 배정) · F-ADM-DSP-02(추천 기사 Top 3, 단계 9)
// BR-070·071·072 차단, 근무·시간 겹침·숙련·지역은 경고 후 확인(confirmWarnings). BR-102 거점 범위.
import { assignInput, unassignInput, z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { assignOrder, previewAssign, recommendTechs, unassignOrder } from '@/server/dispatch';

const MENU = 'A-DSP-010';

/** 배정 전 점검 (경고·차단 목록) */
export async function checkAssign(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    const v = parse(assignInput, values);
    return previewAssign(v, await currentBranchFilter(admin));
  });
}

/** 배정 확정. 경고가 있고 confirmWarnings가 아니면 저장하지 않고 경고를 돌려준다 */
export async function assign(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const v = parse(assignInput, values);
    const r = await assignOrder(v, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    if (r.saved) revalidatePath('/admin/dsp/board');
    return r;
  });
}

/** 배정 취소 (배정완료 → 배정대기) */
export async function unassign(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const v = parse(unassignInput, values);
    await unassignOrder(v, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/dsp/board');
  });
}

/** F-ADM-DSP-02 추천 기사 Top 3 (관할·숙련·부하·이동시간·평점 점수). 추천만 보여 주고 배정은 운영자가 고른다 */
export async function recommendAction(orderId: number) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    return recommendTechs(parse(z.coerce.number().int().positive(), orderId), await currentBranchFilter(admin));
  });
}
