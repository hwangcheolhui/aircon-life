import 'server-only';
/**
 * 기사 업무지원 서버 서비스 (단계 10):
 * - 자재 F-TEC-MAT-01·02 (T-MAT-010·020): 보유 자재·안전재고 미달, 요청·취소·수령(보유 +), 현장 자재 사용 시 보유 −(materials.ts)
 * - 퀵메뉴 F-TEC-HOM-04 (T-MY-020·T-HOM-010·T-MORE-010)
 * - 홈 F-TEC-HOM-02·03·05: 오늘의 메모·자재, 주간 할일 D~D+2, 이번 달 VOC·NPS·평점·완료 배지
 * - 캘린더 F-TEC-CAL-01·02 (T-CAL-010), 주간 일정 F-TEC-RTE-05 (T-RTE-030)
 * - 내 교육·등급 F-TEC-EDU-02 (T-EDU-020), 월 수입 F-TEC-STL-03 (T-STL-010)
 */
import {
  assignment,
  material,
  materialRequest,
  quickMenu,
  review,
  serviceOrder,
  technician,
  technicianGradeHistory,
  technicianMaterialStock,
  trainingCourse,
  trainingEnrollment,
  voc,
  workSchedule,
} from '@aircon/db';
import {
  CONFIRMED_ASSIGN_STATUSES,
  SETTING_KEYS,
  accompanyProgress,
  addDaysStr,
  assertMaterialRequestTransition,
  checkMaterialRequest,
  isBelowSafetyStock,
  kpiNps,
  kstDate,
  monthGrid,
  monthlyIncome,
  nextStockQuantity,
  normalizeQuickMenu,
  recentMonths,
  todayMaterials,
  weekGrid,
  weeklyTodo,
  workDaySummary,
  memoOccursOn,
} from '@aircon/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { UserError, ValidationFailed } from './action-result';
import { getDb } from './db';
import { longPendingIds } from './pending';
import { getSettingNumber, getSettingString } from './settings';
import { listTechSettlements } from './settlements';
import { techMemosOn, techMemosOverlapping } from './tech-memos';

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const kstStart = (d: string) => new Date(`${d}T00:00:00+09:00`);
const kstHm = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });

/* ---------- 자재 (T-MAT-010·020) ---------- */

/** 보유 자재: 사용 중인 자재 마스터 전부 + 내 보유 수량(없으면 0), 안전재고 미달 먼저 */
export async function listTechStock(techId: number) {
  const rows = await getDb()
    .select({ id: material.id, code: material.materialCode, name: material.name, unit: material.unit, safetyStock: material.safetyStock, quantity: technicianMaterialStock.quantity, updatedAt: technicianMaterialStock.updatedAt })
    .from(material)
    .leftJoin(technicianMaterialStock, and(eq(technicianMaterialStock.materialId, material.id), eq(technicianMaterialStock.technicianId, techId)))
    .where(eq(material.isActive, true))
    .orderBy(asc(material.name));
  return rows
    .map((r) => ({ ...r, quantity: r.quantity ?? 0, below: isBelowSafetyStock(r.quantity ?? 0, r.safetyStock) }))
    .sort((a, b) => Number(b.below) - Number(a.below));
}

export async function activeMaterials() {
  return getDb().select({ id: material.id, name: material.name, unit: material.unit }).from(material).where(eq(material.isActive, true)).orderBy(asc(material.name));
}

/** 내 자재 요청 (최근 90일 + 아직 받지 않은 것) */
export async function listTechMaterialRequests(techId: number, now = new Date()) {
  const since = new Date(now.getTime() - 90 * 86_400_000);
  return getDb()
    .select({
      id: materialRequest.id,
      materialName: material.name,
      unit: material.unit,
      quantity: materialRequest.quantity,
      neededDate: materialRequest.neededDate,
      status: materialRequest.status,
      orderNo: serviceOrder.orderNo,
      createdAt: materialRequest.createdAt,
      receivedAt: materialRequest.receivedAt,
    })
    .from(materialRequest)
    .innerJoin(material, eq(material.id, materialRequest.materialId))
    .leftJoin(serviceOrder, eq(serviceOrder.id, materialRequest.relatedOrderId))
    .where(and(eq(materialRequest.technicianId, techId), or(inArray(materialRequest.status, ['REQUESTED', 'SHIPPED']), gte(materialRequest.createdAt, since))))
    .orderBy(desc(materialRequest.createdAt))
    .limit(200);
}

/** F-TEC-MAT-02 자재 요청 */
export async function createMaterialRequest(techId: number, input: { materialId: number; quantity: number; neededDate: string; relatedOrderNo: string | null }, now = new Date()) {
  const db = getDb();
  const [m] = await db.select().from(material).where(eq(material.id, input.materialId));
  const errors = checkMaterialRequest({ materialActive: m ? m.isActive : null, quantity: input.quantity, neededDate: input.neededDate, today: kstDate(now) });
  if (errors) throw new ValidationFailed(errors);
  let relatedOrderId: number | null = null;
  if (input.relatedOrderNo) {
    const [o] = await db
      .select({ id: serviceOrder.id })
      .from(serviceOrder)
      .innerJoin(assignment, eq(assignment.orderId, serviceOrder.id))
      .where(and(eq(serviceOrder.orderNo, input.relatedOrderNo), eq(assignment.technicianId, techId), inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES])));
    if (!o) throw new ValidationFailed({ relatedOrderNo: '내 작업의 접수번호만 연결할 수 있습니다.' });
    relatedOrderId = o.id;
  }
  const [row] = await db
    .insert(materialRequest)
    .values({ technicianId: techId, materialId: input.materialId, quantity: input.quantity, neededDate: input.neededDate, relatedOrderId, status: 'REQUESTED', createdBy: techId, updatedBy: techId })
    .returning({ id: materialRequest.id });
  return row!.id;
}

/** 보유 수량 더하기·빼기 (0 아래로 내려가지 않음) — 수령(+)·현장 사용(−)·사용 취소(+) */
export async function adjustTechStock(tx: Tx | Db, techId: number, materialId: number, delta: number, now = new Date()) {
  const [cur] = await tx
    .select({ q: technicianMaterialStock.quantity })
    .from(technicianMaterialStock)
    .where(and(eq(technicianMaterialStock.technicianId, techId), eq(technicianMaterialStock.materialId, materialId)))
    .for('update');
  const next = nextStockQuantity(cur?.q ?? 0, delta);
  if (cur) {
    await tx
      .update(technicianMaterialStock)
      .set({ quantity: next, updatedAt: now })
      .where(and(eq(technicianMaterialStock.technicianId, techId), eq(technicianMaterialStock.materialId, materialId)));
  } else if (next > 0) {
    await tx.insert(technicianMaterialStock).values({ technicianId: techId, materialId, quantity: next, updatedAt: now }).onConflictDoNothing();
  }
}

/** [요청 취소](요청 상태만) · [수령 확인](요청·이동중 → 수령, 보유 +수량) */
export async function changeMaterialRequest(techId: number, id: number, to: 'CANCELED' | 'RECEIVED', now = new Date()) {
  await getDb().transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(materialRequest)
      .where(and(eq(materialRequest.id, id), eq(materialRequest.technicianId, techId)))
      .for('update');
    if (!r) throw new UserError('자재 요청을 찾을 수 없습니다.');
    try {
      assertMaterialRequestTransition(r.status, to);
    } catch {
      throw new UserError(to === 'CANCELED' ? '이미 불출됐거나 끝난 요청은 취소할 수 없습니다.' : '이미 처리된 요청입니다.');
    }
    await tx
      .update(materialRequest)
      .set({ status: to, receivedAt: to === 'RECEIVED' ? now : null, updatedAt: now, updatedBy: techId })
      .where(eq(materialRequest.id, id));
    if (to === 'RECEIVED') await adjustTechStock(tx, techId, r.materialId, r.quantity, now);
  });
}

/* ---------- 퀵메뉴 (T-MY-020) ---------- */

export async function getQuickMenu(techId: number): Promise<string[]> {
  const rows = await getDb()
    .select({ code: quickMenu.menuCode })
    .from(quickMenu)
    .where(and(eq(quickMenu.userType, 'TECHNICIAN'), eq(quickMenu.userId, techId)))
    .orderBy(asc(quickMenu.sortOrder), asc(quickMenu.id));
  return normalizeQuickMenu(rows.map((r) => r.code));
}

/** 전체 교체 저장 (순서 = sort_order) */
export async function saveQuickMenu(techId: number, codes: string[], now = new Date()) {
  const clean = normalizeQuickMenu(codes);
  await getDb().transaction(async (tx) => {
    await tx.delete(quickMenu).where(and(eq(quickMenu.userType, 'TECHNICIAN'), eq(quickMenu.userId, techId)));
    if (clean.length)
      await tx.insert(quickMenu).values(clean.map((menuCode, i) => ({ userType: 'TECHNICIAN', userId: techId, menuCode, sortOrder: (i + 1) * 10, createdAt: now, createdBy: techId, updatedAt: now, updatedBy: techId })));
  });
  return clean;
}

/* ---------- 약속(배정) 기간 조회 ---------- */

/** 내게 확정된 배정 중 약속일이 from~to(포함, 한국 날짜)인 작업 */
export async function techJobsBetween(techId: number, from: string, to: string, now = new Date()) {
  const rows = await getDb()
    .select({
      orderId: serviceOrder.id,
      orderNo: serviceOrder.orderNo,
      status: serviceOrder.status,
      promisedAt: serviceOrder.promisedAt,
      scheduledStart: assignment.scheduledStart,
      scheduledEnd: assignment.scheduledEnd,
    })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .where(
      and(
        eq(assignment.technicianId, techId),
        inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES]),
        isNull(serviceOrder.deletedAt),
        gte(serviceOrder.promisedAt, kstStart(from)),
        lt(serviceOrder.promisedAt, kstStart(addDaysStr(to, 1))),
      ),
    )
    .orderBy(asc(serviceOrder.promisedAt));
  const overdue = await longPendingIds(rows.map((r) => ({ id: r.orderId, status: r.status })), now);
  return rows.map((r) => {
    const start = r.scheduledStart ?? r.promisedAt!;
    const end = r.scheduledEnd ?? new Date(start.getTime() + 60 * 60_000);
    return {
      orderNo: r.orderNo,
      status: r.status,
      date: kstDate(r.promisedAt!),
      start: kstHm(start),
      end: kstHm(end),
      longPending: overdue.has(r.orderId),
    };
  });
}

async function schedulesBetween(techId: number, from: string, to: string) {
  return getDb()
    .select({ workDate: workSchedule.workDate, scheduleType: workSchedule.scheduleType, startTime: workSchedule.startTime, endTime: workSchedule.endTime, note: workSchedule.note })
    .from(workSchedule)
    .where(and(eq(workSchedule.technicianId, techId), gte(workSchedule.workDate, from), lt(workSchedule.workDate, addDaysStr(to, 1))));
}

/* ---------- 캘린더 (T-CAL-010) ---------- */

export async function techCalendar(tech: { id: number; name: string }, month: string, now = new Date()) {
  const weeks = monthGrid(month);
  const dates = weeks.flat().filter((d): d is string => d !== null);
  const from = dates[0]!;
  const to = dates.at(-1)!;
  const today = kstDate(now);
  const [jobs, schedules, memos] = await Promise.all([techJobsBetween(tech.id, from, to, now), schedulesBetween(tech.id, from, to), techMemosOverlapping(tech, from, to)]);
  const days = Object.fromEntries(
    dates.map((d) => [
      d,
      {
        work: workDaySummary(d, today, jobs),
        scheduleType: schedules.find((s) => s.workDate === d)?.scheduleType ?? null,
        memoCount: memos.filter((m) => memoOccursOn(m, d)).length,
      },
    ]),
  );
  return { weeks, days, today };
}

/** 캘린더 아래 그날 목록: 작업(근무 모드) + 메모(메모 모드) */
export async function techCalendarDay(tech: { id: number; name: string }, date: string, now = new Date()) {
  const [jobs, memos, sched] = await Promise.all([techJobsBetween(tech.id, date, date, now), techMemosOn(tech, date), schedulesBetween(tech.id, date, date)]);
  return { jobs, memos, schedule: sched[0] ?? null };
}

/* ---------- 주간 일정 (T-RTE-030) ---------- */

export async function techWeek(techId: number, startDate: string, now = new Date()) {
  const end = addDaysStr(startDate, 6);
  const [jobs, schedules, fromHour, toHour, defaultStart, defaultEnd] = await Promise.all([
    techJobsBetween(techId, startDate, end, now),
    schedulesBetween(techId, startDate, end),
    getSettingNumber(SETTING_KEYS.WEEK_GRID_START_HOUR),
    getSettingNumber(SETTING_KEYS.WEEK_GRID_END_HOUR),
    getSettingString(SETTING_KEYS.WORK_DEFAULT_START),
    getSettingString(SETTING_KEYS.WORK_DEFAULT_END),
  ]);
  const from = Number.isFinite(fromHour) ? Math.max(0, Math.min(23, fromHour)) : 8;
  const to = Number.isFinite(toHour) ? Math.max(from + 1, Math.min(24, toHour)) : 20;
  return weekGrid({ startDate, fromHour: from, toHour: to, schedules, jobs, defaults: { defaultStart, defaultEnd } });
}

/* ---------- 홈 (T-HOM-010) ---------- */

/** 오늘의 메모·자재, 주간 할일 D~D+2 */
export async function techHomeTodo(tech: { id: number; name: string }, now = new Date()) {
  const today = kstDate(now);
  const last = addDaysStr(today, 2);
  const db = getDb();
  const [memos, materials, jobs] = await Promise.all([
    techMemosOverlapping(tech, today, last),
    db
      .select({ id: materialRequest.id, status: materialRequest.status, neededDate: materialRequest.neededDate, quantity: materialRequest.quantity, materialName: material.name, unit: material.unit })
      .from(materialRequest)
      .innerJoin(material, eq(material.id, materialRequest.materialId))
      .where(and(eq(materialRequest.technicianId, tech.id), inArray(materialRequest.status, ['REQUESTED', 'SHIPPED'])))
      .orderBy(asc(materialRequest.neededDate)),
    techJobsBetween(tech.id, today, last, now),
  ]);
  const todayMemos = memos.filter((m) => memoOccursOn(m, today));
  return {
    todayMemos: { total: todayMemos.length, done: todayMemos.filter((m) => m.isDone || (!m.mine && m.readAt)).length },
    todayMaterials: todayMaterials(materials, today),
    weekly: weeklyTodo({ today, memos, materials, jobs }),
  };
}

/** 내 지표 배지: 이번 달 VOC 건수·NPS(이번 달 후기 누적)·평균 평점·완료 건수 */
export async function techMonthBadges(techId: number, now = new Date()) {
  const month = kstDate(now).slice(0, 7);
  const from = kstStart(`${month}-01`);
  const db = getDb();
  const [[v], scores, [t], [done]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(voc).where(and(eq(voc.technicianId, techId), gte(voc.createdAt, from))),
    db
      .select({ s: review.npsScore })
      .from(review)
      .where(and(eq(review.technicianId, techId), gte(review.createdAt, from), sql`${review.npsScore} is not null`)),
    db.select({ rating: technician.ratingAvg }).from(technician).where(eq(technician.id, techId)),
    db
      .select({ n: sql<number>`count(distinct ${serviceOrder.id})::int` })
      .from(serviceOrder)
      .innerJoin(assignment, eq(assignment.orderId, serviceOrder.id))
      .where(
        and(
          eq(assignment.technicianId, techId),
          inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES]),
          inArray(serviceOrder.status, ['WORK_DONE', 'COMPLETED']),
          gte(serviceOrder.promisedAt, from),
        ),
      ),
  ]);
  return {
    month,
    vocCount: v?.n ?? 0,
    nps: kpiNps(scores.map((r) => r.s!)),
    npsCount: scores.length,
    rating: t?.rating === null || t?.rating === undefined ? null : Number(t.rating),
    completed: done?.n ?? 0,
  };
}

/* ---------- 내 교육·등급 (T-EDU-020) ---------- */

export async function techEducation(techId: number) {
  const db = getDb();
  const [[t], enrollments, grades] = await Promise.all([
    db
      .select({ grade: technician.grade, status: technician.status, joinedAt: technician.joinedAt, done: technician.accompanyDoneCount, required: technician.accompanyRequiredCount })
      .from(technician)
      .where(eq(technician.id, techId)),
    db
      .select({
        id: trainingEnrollment.id,
        courseName: trainingCourse.name,
        courseType: trainingCourse.courseType,
        startDate: trainingCourse.startDate,
        endDate: trainingCourse.endDate,
        totalHours: trainingCourse.totalHours,
        attendanceRate: trainingEnrollment.attendanceRate,
        practicalScore: trainingEnrollment.practicalScore,
        result: trainingEnrollment.result,
        completedAt: trainingEnrollment.completedAt,
        certificateNo: trainingEnrollment.certificateNo,
      })
      .from(trainingEnrollment)
      .innerJoin(trainingCourse, eq(trainingCourse.id, trainingEnrollment.courseId))
      .where(eq(trainingEnrollment.technicianId, techId))
      .orderBy(desc(trainingEnrollment.createdAt)),
    db
      .select({ id: technicianGradeHistory.id, fromGrade: technicianGradeHistory.fromGrade, toGrade: technicianGradeHistory.toGrade, reason: technicianGradeHistory.reason, effectiveDate: technicianGradeHistory.effectiveDate })
      .from(technicianGradeHistory)
      .where(eq(technicianGradeHistory.technicianId, techId))
      .orderBy(desc(technicianGradeHistory.effectiveDate), desc(technicianGradeHistory.id)),
  ]);
  if (!t) throw new UserError('기사 정보를 찾을 수 없습니다.');
  return { ...t, accompany: accompanyProgress(t.done, t.required), enrollments, grades };
}

/* ---------- 월 수입 (T-STL-010) ---------- */

export async function techMonthlyIncome(techId: number, now = new Date(), months = 6) {
  const rows = await listTechSettlements(techId);
  return monthlyIncome(
    rows.map((r) => ({ periodEnd: r.periodEnd, netPay: r.netPay })),
    recentMonths(kstDate(now), months),
  );
}
