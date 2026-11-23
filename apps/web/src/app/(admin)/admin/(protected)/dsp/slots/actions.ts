'use server';
// A-DSP-030 운영 슬롯 관리 · F-ADM-DSP-05 (수용 건수·마감 수동 조정, 근무표 기준 재계산). BR-102 자기 거점만. BR-021 예약 건수 아래로 줄일 수 없다.
import { slotGenerateInput, slotUpdateInput } from '@aircon/contracts';
import { timeSlot } from '@aircon/db';
import { canAccessBranch } from '@aircon/domain';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { UserError, handle, parse } from '@/server/action-result';
import { ForbiddenError, requirePermission } from '@/server/auth';
import { getDb } from '@/server/db';
import { recalcSlots } from '@/server/slots';

const MENU = 'A-DSP-030';

export async function saveSlot(values: Record<string, string>, id: string | null) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const v = parse(slotUpdateInput, { ...values, id });
    const [row] = await getDb().select().from(timeSlot).where(eq(timeSlot.id, v.id));
    if (!row || !canAccessBranch(admin, row.branchId)) throw new ForbiddenError('다른 거점의 슬롯은 수정할 수 없습니다.');
    if (v.capacity < row.bookedCount) throw new UserError(`이미 ${row.bookedCount}건 예약돼 있어 수용 건수를 그보다 줄일 수 없습니다.`);
    await getDb()
      .update(timeSlot)
      .set({ capacity: v.capacity, isClosed: v.isClosed, updatedAt: new Date(), updatedBy: admin.adminId })
      .where(eq(timeSlot.id, v.id));
    revalidatePath('/admin/dsp/slots');
  });
}

export async function regenerateSlots(values: Record<string, string>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const v = parse(slotGenerateInput, values);
    if (!canAccessBranch(admin, v.branchId)) throw new ForbiddenError('다른 거점의 슬롯은 수정할 수 없습니다.');
    const n = await recalcSlots(v.branchId, v.dateFrom, v.dateTo, admin.adminId);
    revalidatePath('/admin/dsp/slots');
    return { changed: n };
  });
}
