'use server';
// A-DSP-040 기사 근무 일정 · F-ADM-DSP-06: 기간·요일 일괄 등록(같은 날 일정은 덮어씀). 저장하면 그 기간 슬롯 수용 건수를 근무표 기준으로 다시 맞춘다(F-ADM-DSP-05).
import { scheduleBulkInput } from '@aircon/contracts';
import { technician, workSchedule } from '@aircon/db';
import { canAccessBranch } from '@aircon/domain';
import { inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { UserError, handle, parse } from '@/server/action-result';
import { ForbiddenError, requirePermission } from '@/server/auth';
import { getDb } from '@/server/db';
import { recalcSlots } from '@/server/slots';

export async function saveSchedules(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-DSP-040', 'UPDATE');
    const v = parse(scheduleBulkInput, values);
    const db = getDb();
    const techs = await db.select({ id: technician.id, branchId: technician.branchId }).from(technician).where(inArray(technician.id, v.technicianIds));
    if (techs.length !== v.technicianIds.length) throw new UserError('기사를 찾을 수 없습니다.');
    if (techs.some((t) => !canAccessBranch(admin, t.branchId))) throw new ForbiddenError('다른 거점 기사의 일정은 등록할 수 없습니다.');
    const dates: string[] = [];
    for (let d = new Date(`${v.dateFrom}T00:00:00Z`); d <= new Date(`${v.dateTo}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      if (v.weekdays.includes(d.getUTCDay())) dates.push(d.toISOString().slice(0, 10));
    }
    if (dates.length === 0) throw new UserError('선택한 기간에 해당 요일이 없습니다.');
    if (dates.length > 62) throw new UserError('한 번에 최대 62일까지 등록할 수 있습니다.');
    const rows = techs.flatMap((t) =>
      dates.map((workDate) => ({
        technicianId: t.id,
        workDate,
        scheduleType: v.scheduleType,
        startTime: v.startTime,
        endTime: v.endTime,
        maxJobs: v.maxJobs,
        note: v.note,
        createdBy: admin.adminId,
        updatedBy: admin.adminId,
      })),
    );
    await db
      .insert(workSchedule)
      .values(rows)
      .onConflictDoUpdate({
        target: [workSchedule.technicianId, workSchedule.workDate],
        set: {
          scheduleType: sql`excluded.schedule_type`,
          startTime: sql`excluded.start_time`,
          endTime: sql`excluded.end_time`,
          maxJobs: sql`excluded.max_jobs`,
          note: sql`excluded.note`,
          updatedAt: new Date(),
          updatedBy: admin.adminId,
        },
      });
    for (const branchId of new Set(techs.map((t) => t.branchId))) {
      await recalcSlots(branchId, dates[0]!, dates[dates.length - 1]!, admin.adminId);
    }
    revalidatePath('/admin/dsp/schedules');
    revalidatePath('/admin/dsp/slots');
    return { count: rows.length };
  });
}
