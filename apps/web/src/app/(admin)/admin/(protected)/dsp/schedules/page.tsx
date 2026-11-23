// A-DSP-040 기사 근무 일정 · F-ADM-DSP-06: 기사 × 날짜(2주) 근무 유형 표, 기간·요일 일괄 등록 → 슬롯 수용 건수 반영
import { branch, technician, workSchedule } from '@aircon/db';
import { kstToday } from '@aircon/domain';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { SchedulesScreen } from './screen';

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export default async function SchedulesPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const admin = await requireScreen('A-DSP-040');
  const filter = await currentBranchFilter(admin); // BR-102
  const raw = (await searchParams).from;
  const from = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : kstToday(new Date());
  const dates = Array.from({ length: 14 }, (_, i) => addDays(from, i));
  const db = getDb();
  const techs = await db
    .select({ id: technician.id, techCode: technician.techCode, name: technician.name, branchName: branch.name, status: technician.status })
    .from(technician)
    .innerJoin(branch, eq(branch.id, technician.branchId))
    .where(
      and(
        isNull(technician.deletedAt),
        filter.kind === 'BRANCH' ? eq(technician.branchId, filter.branchId) : filter.kind === 'NONE' ? eq(technician.id, -1) : undefined,
      ),
    )
    .orderBy(asc(branch.name), asc(technician.techCode));
  const schedules = techs.length
    ? await db
        .select()
        .from(workSchedule)
        .where(
          and(
            inArray(
              workSchedule.technicianId,
              techs.map((t) => t.id),
            ),
            gte(workSchedule.workDate, dates[0]!),
            lte(workSchedule.workDate, dates[dates.length - 1]!),
          ),
        )
    : [];
  const codes = await loadCodes(['SCHEDULE_TYPE', 'TECH_STATUS']);
  return (
    <SchedulesScreen
      from={from}
      prev={addDays(from, -14)}
      next={addDays(from, 14)}
      dates={dates}
      techs={techs}
      schedules={schedules.map((s) => ({
        technicianId: s.technicianId,
        workDate: s.workDate,
        scheduleType: s.scheduleType,
        startTime: s.startTime,
        endTime: s.endTime,
      }))}
      codes={codes}
      canUpdate={screenFlags(admin, 'A-DSP-040').canUpdate}
    />
  );
}
