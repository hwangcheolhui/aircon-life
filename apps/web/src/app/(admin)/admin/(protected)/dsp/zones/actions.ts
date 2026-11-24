'use server';
// A-DSP-060 기사 관할 구역 지정 서버 액션 · F-ADM-DSP-08 (법정동 묶음 또는 지도에 직접 그리기). BR-102 거점 범위.
// 저장하면 그 기사의 활동지역(technician_area)이 오늘 유효한 구역으로 다시 만들어진다(BR-110 미배정 노출 기준).
import { zoneDeleteInput, zoneInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { deleteZone, saveZone } from '@/server/zones';

const MENU = 'A-DSP-060';

export async function save(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const v = parse(zoneInput, values);
    await saveZone(v, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/dsp/zones');
  });
}

export async function remove(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'DELETE');
    const v = parse(zoneDeleteInput, values);
    await deleteZone(v.id, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/dsp/zones');
  });
}
