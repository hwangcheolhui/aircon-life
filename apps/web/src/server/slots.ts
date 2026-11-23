import 'server-only';
/**
 * 거점 운영 슬롯 서버 서비스.
 * - F-SYS-01 슬롯 자동 생성(매일 00:10): 기사 근무표(work_schedule) → time_slot. 이미 있는 칸은 건드리지 않는다(수동 조정 보존).
 * - F-ADM-DSP-05 슬롯 재계산(A-DSP-030): 근무표가 바뀐 뒤 수용 건수를 다시 맞춘다. 예약된 건수 아래로는 줄이지 않는다.
 * - F-CUS-RSV-01 가용 시간: 소요시간만큼 연속 슬롯에 잔여가 있는 시작 시각만 보여 준다(BR-021). 야간·휴일 할증 표시(BR-012).
 */
import { branch, holiday, technician, timeSlot, workSchedule } from '@aircon/db';
import {
  SETTING_KEYS,
  type SlotPlanRow,
  availableStartHours,
  buildSlotPlan,
  hourToTime,
  kstToday,
  slotDates,
  slotsNeeded,
  visitSurchargeName,
} from '@aircon/domain';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { UserError } from './action-result';
import { getDb } from './db';
import { loadQuoteCatalog } from './quote';
import { DEMO_HOLIDAYS, isQuoteDemoMode } from './quote-demo';
import { getSettingNumber, getSettingString } from './settings';

type Db = ReturnType<typeof getDb>;

async function slotDefaults() {
  const [defaultStart, defaultEnd, jobsPerTechHour] = await Promise.all([
    getSettingString(SETTING_KEYS.WORK_DEFAULT_START),
    getSettingString(SETTING_KEYS.WORK_DEFAULT_END),
    getSettingNumber(SETTING_KEYS.SLOT_JOBS_PER_TECH_HOUR),
  ]);
  return { defaultStart, defaultEnd, jobsPerTechHour };
}

/** 거점·기간의 근무표 → 슬롯 계획 (재직 기사만) */
async function planFor(db: Db, branchIds: number[], dates: string[]): Promise<SlotPlanRow[]> {
  if (branchIds.length === 0 || dates.length === 0) return [];
  const defaults = await slotDefaults();
  const rows = await db
    .select({
      branchId: technician.branchId,
      technicianId: workSchedule.technicianId,
      workDate: workSchedule.workDate,
      scheduleType: workSchedule.scheduleType,
      startTime: workSchedule.startTime,
      endTime: workSchedule.endTime,
    })
    .from(workSchedule)
    .innerJoin(technician, eq(technician.id, workSchedule.technicianId))
    .where(
      and(
        inArray(technician.branchId, branchIds),
        eq(technician.status, 'ACTIVE'),
        isNull(technician.deletedAt),
        gte(workSchedule.workDate, dates[0]!),
        lte(workSchedule.workDate, dates[dates.length - 1]!),
      ),
    );
  return branchIds.flatMap((branchId) =>
    buildSlotPlan({ branchId, dates, schedules: rows.filter((r) => r.branchId === branchId), ...defaults }),
  );
}

/** F-SYS-01 슬롯 자동 생성: 내일부터 SLOT_DAYS_AHEAD 일, 없는 칸만 만든다. 만든 칸 수를 돌려준다 */
export async function generateSlots(now = new Date()): Promise<number> {
  const db = getDb();
  const days = await getSettingNumber(SETTING_KEYS.SLOT_DAYS_AHEAD);
  const dates = slotDates(kstToday(now), days);
  const branches = await db.select({ id: branch.id }).from(branch).where(and(eq(branch.status, 'ACTIVE'), isNull(branch.deletedAt)));
  const plan = await planFor(
    db,
    branches.map((b) => b.id),
    dates,
  );
  if (plan.length === 0) return 0;
  const inserted = await db
    .insert(timeSlot)
    .values(plan.map((p) => ({ ...p, bookedCount: 0, isClosed: false })))
    .onConflictDoNothing()
    .returning({ id: timeSlot.id });
  return inserted.length;
}

/** F-ADM-DSP-05 재계산: 기간 안의 칸을 근무표 기준 수용 건수로 맞춘다(예약 건수보다 작게는 안 함). 근무가 없어진 칸은 0 */
export async function recalcSlots(branchId: number, dateFrom: string, dateTo: string, actorId: number | null) {
  const db = getDb();
  const dates: string[] = [];
  for (let d = new Date(`${dateFrom}T00:00:00Z`); d <= new Date(`${dateTo}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  if (dates.length > 62) throw new UserError('재계산 기간은 최대 62일입니다.');
  const plan = await planFor(db, [branchId], dates);
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(timeSlot)
      .where(and(eq(timeSlot.branchId, branchId), gte(timeSlot.slotDate, dateFrom), lte(timeSlot.slotDate, dateTo)));
    const key = (r: { slotDate: string; slotHour: number; slotKind: string }) => `${r.slotDate}|${r.slotHour}|${r.slotKind}`;
    const planned = new Map(plan.map((p) => [key(p), p]));
    let changed = 0;
    for (const e of existing) {
      const cap = Math.max(planned.get(key(e))?.capacity ?? 0, e.bookedCount);
      planned.delete(key(e));
      if (cap !== e.capacity) {
        await tx.update(timeSlot).set({ capacity: cap, updatedAt: new Date(), updatedBy: actorId }).where(eq(timeSlot.id, e.id));
        changed++;
      }
    }
    const fresh = [...planned.values()];
    if (fresh.length) {
      await tx.insert(timeSlot).values(fresh.map((p) => ({ ...p, createdBy: actorId, updatedBy: actorId })));
    }
    return changed + fresh.length;
  });
}

/* ---------- F-CUS-RSV-01 가용 시간 ---------- */

export interface DayAvailability {
  date: string;
  hours: { hour: number; label: string; surcharge: string | null }[];
}

/** 체험 모드 슬롯: 평일·토요일 9~17시, 일요일 휴무, 매일 13시는 마감(마감 표시 시험용) */
function demoSlots(date: string) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (dow === 0) return [];
  return Array.from({ length: 9 }, (_, i) => 9 + i).map((h) => ({
    slotHour: h,
    capacity: 2,
    bookedCount: h === 13 ? 2 : 0,
    isClosed: false,
  }));
}

/** 거점의 예약 가능 시작 시각 (내일부터 SLOT_DAYS_AHEAD 일) */
export async function getAvailability(input: {
  branchId: number;
  durationMin: number;
  units?: number;
  now?: Date;
}): Promise<DayAvailability[]> {
  const now = input.now ?? new Date();
  const days = await getSettingNumber(SETTING_KEYS.SLOT_DAYS_AHEAD);
  const dates = slotDates(kstToday(now), days);
  const need = slotsNeeded(input.durationMin);
  const catalog = await loadQuoteCatalog();
  let holidays: readonly string[];
  let byDate: Map<string, { slotHour: number; capacity: number; bookedCount: number; isClosed: boolean }[]>;
  if (isQuoteDemoMode()) {
    holidays = DEMO_HOLIDAYS;
    byDate = new Map(dates.map((d) => [d, demoSlots(d)]));
  } else {
    const db = getDb();
    const [rows, hol] = await Promise.all([
      db
        .select()
        .from(timeSlot)
        .where(
          and(
            eq(timeSlot.branchId, input.branchId),
            eq(timeSlot.slotKind, 'NORMAL'),
            gte(timeSlot.slotDate, dates[0]!),
            lte(timeSlot.slotDate, dates[dates.length - 1]!),
          ),
        )
        .orderBy(asc(timeSlot.slotDate), asc(timeSlot.slotHour)),
      db
        .select({ d: holiday.holidayDate })
        .from(holiday)
        .where(and(gte(holiday.holidayDate, dates[0]!), lte(holiday.holidayDate, dates[dates.length - 1]!))),
    ]);
    holidays = hol.map((h) => h.d);
    byDate = new Map(dates.map((d) => [d, rows.filter((r) => r.slotDate === d)]));
  }
  return dates.map((date) => ({
    date,
    hours: availableStartHours(byDate.get(date) ?? [], need, input.units ?? 1).map((hour) => ({
      hour,
      label: hourToTime(hour),
      surcharge: visitSurchargeName(catalog.surchargeRules, { date, time: hourToTime(hour) }, holidays),
    })),
  }));
}

/** A-DSP-030 목록: 거점·기간의 슬롯 */
export async function listSlots(branchIds: number[] | null, dateFrom: string, dateTo: string) {
  const db = getDb();
  return db
    .select({
      id: timeSlot.id,
      branchId: timeSlot.branchId,
      branchName: branch.name,
      slotDate: timeSlot.slotDate,
      slotHour: timeSlot.slotHour,
      slotKind: timeSlot.slotKind,
      capacity: timeSlot.capacity,
      bookedCount: timeSlot.bookedCount,
      isClosed: timeSlot.isClosed,
      remaining: sql<number>`greatest(${timeSlot.capacity} - ${timeSlot.bookedCount}, 0)`.mapWith(Number),
    })
    .from(timeSlot)
    .innerJoin(branch, eq(branch.id, timeSlot.branchId))
    .where(
      and(
        gte(timeSlot.slotDate, dateFrom),
        lte(timeSlot.slotDate, dateTo),
        branchIds ? inArray(timeSlot.branchId, branchIds) : undefined,
      ),
    )
    .orderBy(asc(timeSlot.slotDate), asc(timeSlot.slotHour), asc(branch.name));
}
