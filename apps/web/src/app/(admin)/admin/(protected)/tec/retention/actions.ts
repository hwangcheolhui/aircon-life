'use server';
// A-TEC-050 정착·이탈 분석 서버 액션 · F-ADM-TEC-07: 이탈 처리(상태 LEFT·이탈일·사유, 기사 상태 전이 domain TECH_STATUS_TRANSITIONS)
import { techLeaveInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { markTechLeft } from '@/server/training';

export async function markTechLeftAction(values: Record<string, string>) {
  return handle(async () => {
    const admin = await requirePermission('A-TEC-050', 'UPDATE');
    await markTechLeft(parse(techLeaveInput, values), admin);
    revalidatePath('/admin/tec/retention');
    revalidatePath('/admin/tec/technicians');
  });
}
