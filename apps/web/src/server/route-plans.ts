import 'server-only';
/**
 * 기사 일자별 코스 (단계 4-2: F-TEC-RTE-01~03, F-SYS-15·16, C-ORD-020 방문 예정 시간).
 * - 코스(route_plan)는 기사 × 일자 1개. 그날 확정 배정(ACCEPTED·TRANSFER_REQUESTED)이 방문지(JOB)가 된다.
 *   syncPlan() 이 배정 변화(운영자 배정·이관·취소·자가 배정)를 코스에 맞춘다: 빠진 작업은 지우고 새 작업은 이동시간이 가장 덜 느는 자리에 넣는다.
 *   확정된 코스의 작업이 바뀌면 다시 작성중(DRAFT)이 되어 재확정해야 한다(마감 후면 자동 확정 배치가 재확정).
 * - 계산은 packages/domain computeSchedule·optimizeRoute·canConfirmRoute (BR-112·114), 마감은 routeConfirmDeadline (BR-113).
 * - 상태 변경은 assertRouteTransition 을 거친다(01 §3.6). 확정하면 배정의 route_order 를 갱신하고, 주기사 코스만 고객에게 방문 예정 시간을 안내한다
 *   (처음이면 VISIT_TIME_NOTICE, 안내한 시각이 바뀐 고객만 VISIT_TIME_CHANGED). 마감 후 확정 코스의 순서 변경은 막는다(단계 9: 기사 요청 → 운영자 승인 A-DSP-070 후 다시 확정할 때까지 편집 가능, changeWindowOpen).
 */
import {
  assignment,
  customer,
  customerAddress,
  orderItem,
  routePlan,
  routeStop,
  serviceOption,
  serviceOrder,
  serviceProduct,
  technician,
  workSchedule,
} from '@aircon/db';
import {
  type LatLng,
  type RouteSchedule,
  type RouteStatus,
  type RouteStopInput,
  type ScheduleInput,
  CONFIRMED_ASSIGN_STATUSES,
  SETTING_KEYS,
  arrivalWindowOf,
  assertRouteTransition,
  bestInsertion,
  canConfirmRoute,
  computeSchedule,
  customerVisitTime,
  isAfterDeadline,
  isConfirmedRoute,
  kstDate,
  maskName,
  optimizeRoute,
  routeConfirmDeadline,
  shortAddress,
} from '@aircon/domain';
import { and, asc, eq, gte, inArray, isNull, lt, ne, notInArray, sql } from 'drizzle-orm';
import { formatDateLabel, formatVisitTime } from '@/customer/format';
import { UserError } from './action-result';
import { getDb } from './db';
import { branchCenter, ensureAddressCoords, toLatLng, travel } from './geo';
import { notifyOrder, notifyStaffWith } from './notify';
import type { Actor, Tx } from './orders';
import { decrypt } from './pii';
import { getSettingNumber, getSettingString } from './settings';

type Db = ReturnType<typeof getDb>;

const DAY = 24 * 3600_000;
const dayRange = (date: string) => {
  const from = new Date(`${date}T00:00:00+09:00`);
  return { from, to: new Date(from.getTime() + DAY) };
};
export const addDays = (ymd: string, n: number) =>
  new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const atTime = (date: string, hhmm: string) => new Date(`${date}T${hhmm.slice(0, 5)}:00+09:00`);
const sameMinute = (a: Date | null, b: Date | null) =>
  Boolean(a && b && Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000));

/* ---------- 재료 ---------- */

interface DayJob {
  assignmentId: number;
  role: string;
  orderId: number;
  orderNo: string;
  orderStatus: string;
  promisedAt: Date | null;
  requestedTimeTo: string | null;
  arrivalWindowStart: Date | null;
  arrivalWindowEnd: Date | null;
  addressId: number;
  roadAddress: string;
  customerName: string | null;
  point: LatLng | null;
  workMin: number;
  devices: { name: string; quantity: number; deviceType: string }[];
}

/** 주문별 예상 작업시간(상품 표준 소요시간 × 대수 + 옵션 소요시간) */
async function workInfo(db: Db | Tx, orderIds: number[]) {
  const out = new Map<
    number,
    { workMin: number; devices: { name: string; quantity: number; deviceType: string }[] }
  >();
  if (!orderIds.length) return out;
  const rows = await db
    .select({
      orderId: orderItem.orderId,
      quantity: orderItem.quantity,
      pName: serviceProduct.name,
      deviceType: serviceProduct.deviceType,
      pMin: serviceProduct.baseDurationMin,
      oMin: serviceOption.durationMin,
    })
    .from(orderItem)
    .leftJoin(serviceProduct, eq(serviceProduct.id, orderItem.productId))
    .leftJoin(serviceOption, eq(serviceOption.id, orderItem.optionId))
    .where(inArray(orderItem.orderId, orderIds));
  for (const r of rows) {
    const cur = out.get(r.orderId) ?? { workMin: 0, devices: [] };
    cur.workMin += ((r.pMin ?? 0) + (r.oMin ?? 0)) * r.quantity;
    if (r.pName && r.deviceType)
      cur.devices.push({ name: r.pName, quantity: r.quantity, deviceType: r.deviceType });
    out.set(r.orderId, cur);
  }
  return out;
}

/** 그날 기사의 확정 배정 (취소된 주문 제외) */
async function loadDayJobs(db: Db | Tx, techId: number, date: string): Promise<DayJob[]> {
  const { from, to } = dayRange(date);
  const rows = await db
    .select({ a: assignment, o: serviceOrder, road: customerAddress.roadAddress, name: customer.name })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
    .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
    .where(
      and(
        eq(assignment.technicianId, techId),
        inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES]),
        ne(serviceOrder.status, 'CANCELED'),
        isNull(serviceOrder.deletedAt),
        gte(serviceOrder.promisedAt, from),
        lt(serviceOrder.promisedAt, to),
      ),
    )
    .orderBy(asc(serviceOrder.promisedAt));
  const [coords, info] = await Promise.all([
    ensureAddressCoords(rows.map((r) => r.o.addressId)),
    workInfo(
      db,
      rows.map((r) => r.o.id),
    ),
  ]);
  return rows.map((r) => ({
    assignmentId: r.a.id,
    role: r.a.role,
    orderId: r.o.id,
    orderNo: r.o.orderNo,
    orderStatus: r.o.status,
    promisedAt: r.o.promisedAt,
    requestedTimeTo: r.o.requestedTimeTo,
    arrivalWindowStart: r.o.arrivalWindowStart,
    arrivalWindowEnd: r.o.arrivalWindowEnd,
    addressId: r.o.addressId,
    roadAddress: r.road,
    customerName: r.name,
    point: coords.get(r.o.addressId) ?? null,
    workMin: info.get(r.o.id)?.workMin || 60,
    devices: info.get(r.o.id)?.devices ?? [],
  }));
}

interface DayContext {
  techId: number;
  branchId: number;
  date: string;
  branchPoint: LatLng | null;
  startAt: Date;
  workEnd: Date;
  bufferMin: number;
  windowHours: number;
  deadline: Date;
  working: boolean;
}

async function dayContext(db: Db | Tx, techId: number, date: string): Promise<DayContext> {
  const [[t], [s], bufferMin, windowHours, deadlineHm, defStart, defEnd] = await Promise.all([
    db.select({ branchId: technician.branchId }).from(technician).where(eq(technician.id, techId)),
    db
      .select()
      .from(workSchedule)
      .where(and(eq(workSchedule.technicianId, techId), eq(workSchedule.workDate, date))),
    getSettingNumber(SETTING_KEYS.ROUTE_TRAVEL_BUFFER_MIN),
    getSettingNumber(SETTING_KEYS.ARRIVAL_WINDOW_HOURS),
    getSettingString(SETTING_KEYS.ROUTE_CONFIRM_DEADLINE),
    getSettingString(SETTING_KEYS.WORK_DEFAULT_START),
    getSettingString(SETTING_KEYS.WORK_DEFAULT_END),
  ]);
  if (!t) throw new UserError('기사를 찾을 수 없습니다.');
  const working = Boolean(s && ['WORK', 'HALF_AM', 'HALF_PM', 'ON_CALL'].includes(s.scheduleType));
  return {
    techId,
    branchId: t.branchId,
    date,
    branchPoint: await branchCenter(t.branchId),
    startAt: atTime(date, s?.startTime ?? defStart),
    workEnd: atTime(date, s?.endTime ?? defEnd),
    bufferMin,
    windowHours,
    deadline: routeConfirmDeadline(date, deadlineHm),
    working,
  };
}

type StopRow = typeof routeStop.$inferSelect;
type PlanRow = typeof routePlan.$inferSelect;

const jobKey = (assignmentId: number) => `A${assignmentId}`;
const stopKey = (id: number) => `S${id}`;

function jobInput(j: DayJob, ctx: DayContext, locked: boolean): RouteStopInput | null {
  if (!j.point) return null;
  const w = arrivalWindowOf(j, ctx.windowHours);
  return {
    key: jobKey(j.assignmentId),
    type: 'JOB',
    point: j.point,
    windowStart: w?.start ?? null,
    windowEnd: w?.end ?? null,
    workMin: j.workMin,
    locked,
  };
}

function rowInput(r: StopRow, ctx: DayContext): RouteStopInput {
  return {
    key: stopKey(r.id),
    type: r.stopType as RouteStopInput['type'],
    point: r.stopType === 'BREAK' ? null : (toLatLng(r.lat, r.lng) ?? ctx.branchPoint),
    windowStart: null,
    windowEnd: null,
    workMin: r.workMin ?? 0,
    locked: r.isLocked,
  };
}

function startOf(plan: PlanRow | null, ctx: DayContext, jobs: DayJob[]): LatLng | null {
  const saved = plan ? toLatLng(plan.startLat, plan.startLng) : null;
  return saved ?? ctx.branchPoint ?? jobs.find((j) => j.point)?.point ?? null;
}

const scheduleInput = (ctx: DayContext, start: LatLng, stops: RouteStopInput[]): ScheduleInput => ({
  start,
  startAt: ctx.startAt,
  stops,
  travel,
  bufferMin: ctx.bufferMin,
  workEnd: ctx.workEnd,
});

/* ---------- 저장 ---------- */

/** 계산 결과를 route_stop 에 반영(순서 UK 충돌을 피하려고 기존 순번을 음수로 비운 뒤 다시 매김) */
async function persistStops(
  tx: Tx,
  plan: PlanRow,
  s: RouteSchedule,
  jobs: DayJob[],
  existing: StopRow[],
  actor: Actor,
  extra: { notified?: Map<string, Date> } = {},
) {
  const byAssign = new Map(existing.filter((r) => r.assignmentId).map((r) => [jobKey(r.assignmentId!), r]));
  const byId = new Map(existing.map((r) => [stopKey(r.id), r]));
  const keep = new Set<number>();
  for (const st of s.stops) {
    const r = byAssign.get(st.key) ?? byId.get(st.key);
    if (r) keep.add(r.id);
  }
  const drop = existing.filter((r) => !keep.has(r.id)).map((r) => r.id);
  if (drop.length) await tx.delete(routeStop).where(inArray(routeStop.id, drop));
  await tx
    .update(routeStop)
    .set({ stopSeq: sql`-${routeStop.stopSeq}` })
    .where(eq(routeStop.routePlanId, plan.id));
  let pos: LatLng | null = toLatLng(plan.startLat, plan.startLng);
  const jobByKey = new Map(jobs.map((j) => [jobKey(j.assignmentId), j]));
  for (const st of s.stops) {
    const r = byAssign.get(st.key) ?? byId.get(st.key);
    const here = st.point ?? pos;
    if (st.point) pos = st.point;
    const j = jobByKey.get(st.key);
    const values = {
      stopSeq: st.seq,
      stopType: st.type,
      assignmentId: j?.assignmentId ?? null,
      orderId: j?.orderId ?? null,
      lat: (here?.lat ?? 0).toFixed(7),
      lng: (here?.lng ?? 0).toFixed(7),
      windowStart: st.windowStart,
      windowEnd: st.windowEnd,
      plannedArrival: st.arrival,
      plannedDeparture: st.departure,
      workMin: st.workMin,
      travelMinFromPrev: st.travelMin,
      distanceMFromPrev: st.distanceM,
      isLocked: st.locked,
      windowViolation: st.violation,
      updatedAt: new Date(),
      updatedBy: actor.id,
      ...(extra.notified?.has(st.key) ? { notifiedArrival: extra.notified.get(st.key)! } : {}),
    };
    if (r) await tx.update(routeStop).set(values).where(eq(routeStop.id, r.id));
    else
      await tx
        .insert(routeStop)
        .values({ ...values, routePlanId: plan.id, status: 'PLANNED', createdBy: actor.id });
  }
  await tx
    .update(routePlan)
    .set({
      totalJobs: s.stops.filter((x) => x.type === 'JOB').length,
      totalDistanceM: s.totalDistanceM,
      totalTravelMin: s.totalTravelMin,
      totalWorkMin: s.totalWorkMin,
      updatedAt: new Date(),
      updatedBy: actor.id,
    })
    .where(eq(routePlan.id, plan.id));
}

async function setPlanStatus(
  tx: Tx,
  plan: PlanRow,
  to: RouteStatus,
  actor: Actor,
  set: Partial<typeof routePlan.$inferInsert> = {},
) {
  if (plan.status !== to) assertRouteTransition(plan.status, to);
  const rows = await tx
    .update(routePlan)
    .set({ ...set, status: to, updatedAt: new Date(), updatedBy: actor.id })
    .where(
      and(eq(routePlan.id, plan.id), eq(routePlan.status, plan.status), eq(routePlan.version, plan.version)),
    )
    .returning({ id: routePlan.id });
  if (!rows.length)
    throw new UserError('다른 곳에서 먼저 코스를 바꿨습니다. 새로고침 후 다시 확인해 주세요.');
}

/* ---------- 코스 맞추기 ---------- */

interface Synced {
  plan: PlanRow;
  ctx: DayContext;
  jobs: DayJob[];
  rows: StopRow[];
  start: LatLng;
  inputs: RouteStopInput[];
  schedule: RouteSchedule;
}

/** 배정 변화를 코스에 반영하고 다시 계산해 저장한다. 그날 작업도 코스도 없으면 null */
export async function syncPlan(
  techId: number,
  date: string,
  actor: Actor = { type: 'SYSTEM', id: null },
): Promise<Synced | null> {
  const db = getDb();
  const ctx = await dayContext(db, techId, date);
  const jobs = await loadDayJobs(db, techId, date);
  let [plan] = await db
    .select()
    .from(routePlan)
    .where(and(eq(routePlan.technicianId, techId), eq(routePlan.planDate, date)));
  if (!plan && jobs.length === 0) return null;
  const start = startOf(plan ?? null, ctx, jobs);
  if (!start) return null; // 좌표를 하나도 모름 (지오코딩 실패)
  if (!plan) {
    await db
      .insert(routePlan)
      .values({
        technicianId: techId,
        planDate: date,
        status: 'DRAFT',
        startPointType: 'BRANCH',
        startLat: start.lat.toFixed(7),
        startLng: start.lng.toFixed(7),
        endPointType: 'NONE',
        confirmDeadline: ctx.deadline,
        optimizeMethod: 'MANUAL',
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .onConflictDoNothing();
    [plan] = await db
      .select()
      .from(routePlan)
      .where(and(eq(routePlan.technicianId, techId), eq(routePlan.planDate, date)));
  }
  const p = plan!;
  const rows = await db
    .select()
    .from(routeStop)
    .where(eq(routeStop.routePlanId, p.id))
    .orderBy(asc(routeStop.stopSeq));
  const jobByKey = new Map(jobs.map((j) => [jobKey(j.assignmentId), j]));
  // 1) 기존 순서 유지 (빠진 작업 제거)
  let inputs: RouteStopInput[] = [];
  const present = new Set<string>();
  for (const r of rows) {
    if (r.stopType === 'JOB') {
      const j = r.assignmentId ? jobByKey.get(jobKey(r.assignmentId)) : undefined;
      const inp = j ? jobInput(j, ctx, r.isLocked) : null;
      if (inp) {
        inputs.push(inp);
        present.add(inp.key);
      }
    } else inputs.push(rowInput(r, ctx));
  }
  const removed = rows.filter(
    (r) => r.stopType === 'JOB' && !(r.assignmentId && present.has(jobKey(r.assignmentId))),
  ).length;
  // 2) 새 작업은 이동시간이 가장 덜 느는 자리에 (첫 생성이면 약속 시각 순)
  let added = 0;
  for (const j of jobs) {
    const inp = jobInput(j, ctx, false);
    if (!inp || present.has(inp.key)) continue;
    if (rows.length === 0) inputs.push(inp);
    else
      inputs = [...bestInsertion(scheduleInput(ctx, start, inputs), inp).schedule.stops.map(stripSchedule)];
    present.add(inp.key);
    added++;
  }
  const schedule = computeSchedule(scheduleInput(ctx, start, inputs));
  await db.transaction(async (tx) => {
    if ((added || removed) && rows.length > 0 && (p.status === 'OPTIMIZED' || p.status === 'CONFIRMED')) {
      // 확정·추천 후 작업이 바뀜 → 다시 작성중 (재확정 필요). 이미 출발한 날(진행중·완료, 단계 5-1)은 상태를 되돌리지 않는다
      await setPlanStatus(tx, p, 'DRAFT', actor);
      p.status = 'DRAFT';
    }
    await persistStops(tx, p, schedule, jobs, rows, actor);
  });
  const fresh = await db
    .select()
    .from(routeStop)
    .where(eq(routeStop.routePlanId, p.id))
    .orderBy(asc(routeStop.stopSeq));
  const [reloaded] = await db.select().from(routePlan).where(eq(routePlan.id, p.id));
  return {
    plan: reloaded!,
    ctx,
    jobs,
    rows: fresh,
    start,
    inputs: rekey(schedule.stops.map(stripSchedule), fresh, jobs),
    schedule,
  };
}

const stripSchedule = (s: RouteStopInput): RouteStopInput => ({
  key: s.key,
  type: s.type,
  point: s.point,
  windowStart: s.windowStart,
  windowEnd: s.windowEnd,
  workMin: s.workMin,
  locked: s.locked,
});

/** 저장 후 새로 생긴 휴식 지점 등의 임시 키를 실제 S{id} 로 */
function rekey(inputs: RouteStopInput[], rows: StopRow[], jobs: DayJob[]): RouteStopInput[] {
  const jobKeys = new Set(jobs.map((j) => jobKey(j.assignmentId)));
  return inputs.map((inp, i) => {
    if (jobKeys.has(inp.key)) return inp;
    const r = rows[i];
    return r ? { ...inp, key: stopKey(r.id) } : inp;
  });
}

/* ---------- 화면 데이터 (T-MAP-010, T-RTE-010) ---------- */

export interface RouteStopView {
  key: string;
  type: string;
  seq: number;
  orderNo: string | null;
  orderStatus: string | null;
  role: string | null;
  customerName: string | null;
  address: string | null;
  devices: string;
  point: LatLng | null;
  windowStart: string | null;
  windowEnd: string | null;
  arrival: string;
  departure: string;
  travelMin: number;
  distanceM: number;
  workMin: number;
  waitMin: number;
  locked: boolean;
  violation: boolean;
  overWorkEnd: boolean;
  notifiedArrival: string | null;
  /** 단계 9 진행 중 ETA(위치·작업 종료로 재계산)와 안내 시각 대비 지연(분) */
  eta: string | null;
  etaDelayMin: number | null;
}

export interface RouteView {
  date: string;
  planId: number;
  status: string;
  version: number;
  confirmedAt: string | null;
  deadline: string;
  afterDeadline: boolean;
  /** 마감 후 확정 코스 → 순서 변경 불가 (단계 9: 변경 승인 후 다시 확정 전까지는 풀림) */
  locked: boolean;
  /** 단계 9 코스 변경 요청 상태 */
  changeRequest: { status: string; note: string | null; handleNote: string | null; open: boolean } | null;
  start: LatLng;
  totals: { travelMin: number; distanceM: number; workMin: number; jobs: number };
  violations: number;
  overWorkEnd: boolean;
  workEnd: string;
  working: boolean;
  stops: RouteStopView[];
  /** 좌표를 몰라 코스에서 빠진 작업 */
  missing: string[];
}

/** 진행 중 ETA 와 지연(안내 시각, 없으면 계획 도착 대비). 아직 도착하지 않은 정류장만 */
function etaOf(row: StopRow | undefined): { eta: string | null; etaDelayMin: number | null } {
  if (!row?.eta || row.status !== 'PLANNED') return { eta: null, etaDelayMin: null };
  const ref = row.notifiedArrival ?? row.plannedArrival;
  return { eta: row.eta.toISOString(), etaDelayMin: ref ? Math.round((row.eta.getTime() - ref.getTime()) / 60_000) : null };
}

function toView(
  syn: Pick<Synced, 'plan' | 'ctx' | 'jobs' | 'rows' | 'start'>,
  s: RouteSchedule,
  now = new Date(),
): RouteView {
  const jobByKey = new Map(syn.jobs.map((j) => [jobKey(j.assignmentId), j]));
  const rowByKey = new Map(syn.rows.map((r) => [r.assignmentId ? jobKey(r.assignmentId) : stopKey(r.id), r]));
  const after = isAfterDeadline(now, syn.ctx.deadline);
  return {
    date: syn.ctx.date,
    planId: syn.plan.id,
    status: syn.plan.status,
    version: syn.plan.version,
    confirmedAt: syn.plan.confirmedAt?.toISOString() ?? null,
    deadline: syn.ctx.deadline.toISOString(),
    afterDeadline: after,
    locked: after && isConfirmedRoute(syn.plan.status) && !changeWindowOpen(syn.plan),
    changeRequest: syn.plan.changeRequestStatus
      ? { status: syn.plan.changeRequestStatus, note: syn.plan.changeRequestNote, handleNote: syn.plan.changeHandleNote, open: changeWindowOpen(syn.plan) }
      : null,
    start: syn.start,
    totals: {
      travelMin: s.totalTravelMin,
      distanceM: s.totalDistanceM,
      workMin: s.totalWorkMin,
      jobs: s.stops.filter((x) => x.type === 'JOB').length,
    },
    violations: s.violations,
    overWorkEnd: s.overWorkEnd,
    workEnd: syn.ctx.workEnd.toISOString(),
    working: syn.ctx.working,
    stops: s.stops.map((st) => {
      const j = jobByKey.get(st.key);
      return {
        key: st.key,
        type: st.type,
        seq: st.seq,
        orderNo: j?.orderNo ?? null,
        orderStatus: j?.orderStatus ?? null,
        role: j?.role ?? null,
        customerName: j ? maskName(decrypt(j.customerName)) : null,
        address: j ? shortAddress(j.roadAddress) : null,
        devices: j ? j.devices.map((d) => `${d.name} ${d.quantity}대`).join(', ') : '',
        point: st.point,
        windowStart: st.windowStart?.toISOString() ?? null,
        windowEnd: st.windowEnd?.toISOString() ?? null,
        arrival: st.arrival.toISOString(),
        departure: st.departure.toISOString(),
        travelMin: st.travelMin,
        distanceM: st.distanceM,
        workMin: st.workMin,
        waitMin: st.waitMin,
        locked: st.locked,
        violation: st.violation,
        overWorkEnd: st.overWorkEnd,
        notifiedArrival: rowByKey.get(st.key)?.notifiedArrival?.toISOString() ?? null,
        ...etaOf(rowByKey.get(st.key)),
      };
    }),
    missing: syn.jobs.filter((j) => !j.point).map((j) => j.orderNo),
  };
}

/** 코스 화면 데이터. 마감이 지난 미확정 코스는 먼저 자동 확정한다(배치가 늦게 돌아도 같은 결과) */
export async function getRouteView(
  techId: number,
  date: string,
  now = new Date(),
): Promise<RouteView | null> {
  let syn = await syncPlan(techId, date, { type: 'TECHNICIAN', id: techId });
  if (!syn) return null;
  if (date >= kstDate(now) && isAfterDeadline(now, syn.ctx.deadline) && !isConfirmedRoute(syn.plan.status)) {
    await autoConfirm(techId, date);
    syn = await syncPlan(techId, date, { type: 'SYSTEM', id: null });
    if (!syn) return null;
  }
  return toView(syn, syn.schedule, now);
}

/* ---------- F-TEC-RTE-01 코스 편집 ---------- */

export interface RouteEditStop {
  key: string;
  type: 'JOB' | 'BREAK' | 'MATERIAL';
  locked: boolean;
  workMin?: number;
}

/** 편집안 → 계산 입력 (작업 목록이 지금 배정과 같아야 함) */
function editInputs(syn: Synced, edit: RouteEditStop[]): RouteStopInput[] {
  const current = new Map(syn.inputs.map((i) => [i.key, i]));
  const jobKeys = syn.inputs
    .filter((i) => i.type === 'JOB')
    .map((i) => i.key)
    .sort();
  const editJobs = edit
    .filter((e) => e.type === 'JOB')
    .map((e) => e.key)
    .sort();
  if (jobKeys.join() !== editJobs.join())
    throw new UserError('그사이 작업이 바뀌었습니다. 새로고침 후 다시 편집해 주세요.');
  return edit.map((e) => {
    const cur = current.get(e.key);
    if (e.type === 'JOB') return { ...cur!, locked: e.locked };
    const workMin = Math.max(5, Math.min(240, Math.round(e.workMin ?? cur?.workMin ?? 60)));
    return {
      key: cur ? e.key : `N${e.key}`,
      type: e.type,
      point: e.type === 'BREAK' ? null : syn.ctx.branchPoint,
      windowStart: null,
      windowEnd: null,
      workMin,
      locked: e.locked,
    };
  });
}

/** 순서를 바꾼 즉시 다시 계산 (저장하지 않음) */
export async function previewRoute(techId: number, date: string, edit: RouteEditStop[]): Promise<RouteView> {
  const syn = await syncPlan(techId, date, { type: 'TECHNICIAN', id: techId });
  if (!syn) throw new UserError('그날 코스가 없습니다.');
  const s = computeSchedule(scheduleInput(syn.ctx, syn.start, editInputs(syn, edit)));
  return toView(syn, s);
}

/**
 * 단계 9 코스 변경 승인(F-ADM-DSP-09, A-DSP-070): 운영자가 승인한 뒤 다시 확정할 때까지는 마감 후에도 편집할 수 있다.
 * 다시 확정하면(confirmed_at > change_handled_at) 다시 잠긴다. 열려 있는 동안은 자동 확정이 기사 편집을 덮어쓰지 않는다.
 */
export function changeWindowOpen(plan: Pick<PlanRow, 'changeRequestStatus' | 'changeHandledAt' | 'confirmedAt'>) {
  return plan.changeRequestStatus === 'APPROVED' && plan.changeHandledAt !== null && (!plan.confirmedAt || plan.confirmedAt < plan.changeHandledAt);
}

function assertEditable(syn: Synced, now = new Date()) {
  if (isAfterDeadline(now, syn.ctx.deadline) && isConfirmedRoute(syn.plan.status) && !changeWindowOpen(syn.plan))
    throw new UserError('확정 마감이 지나 코스를 바꿀 수 없습니다. 바꿔야 하면 거점에 요청해 주세요.');
  if (syn.plan.status === 'IN_PROGRESS' || syn.plan.status === 'DONE')
    throw new UserError('진행 중이거나 끝난 코스는 바꿀 수 없습니다.');
}

/** 편집 저장 → 작성중(DRAFT). 확정 코스를 마감 전에 바꾸면 다시 확정해야 고객 안내가 나간다 */
export async function saveRoute(techId: number, date: string, edit: RouteEditStop[]): Promise<RouteView> {
  const actor: Actor = { type: 'TECHNICIAN', id: techId };
  const syn = await syncPlan(techId, date, actor);
  if (!syn) throw new UserError('그날 코스가 없습니다.');
  assertEditable(syn);
  const s = computeSchedule(scheduleInput(syn.ctx, syn.start, editInputs(syn, edit)));
  await getDb().transaction(async (tx) => {
    await setPlanStatus(tx, syn.plan, 'DRAFT', actor, { optimizeMethod: 'MANUAL' });
    await persistStops(tx, syn.plan, s, syn.jobs, syn.rows, actor);
  });
  return (await getRouteView(techId, date))!;
}

/* ---------- F-TEC-RTE-02 자동 추천 ---------- */

export async function recommendRoute(techId: number, date: string) {
  const syn = await syncPlan(techId, date, { type: 'TECHNICIAN', id: techId });
  if (!syn) throw new UserError('그날 코스가 없습니다.');
  const r = optimizeRoute(scheduleInput(syn.ctx, syn.start, syn.inputs));
  return {
    before: toView(syn, r.before),
    after: toView(syn, r.after),
    savedTravelMin: r.savedTravelMin,
    savedDistanceM: r.savedDistanceM,
    unavoidable: r.unavoidable,
  };
}

/** 추천 순서 적용 → OPTIMIZED */
export async function applyRecommendation(
  techId: number,
  date: string,
  actor: Actor = { type: 'TECHNICIAN', id: techId },
) {
  const syn = await syncPlan(techId, date, actor);
  if (!syn) throw new UserError('그날 코스가 없습니다.');
  if (actor.type === 'TECHNICIAN') assertEditable(syn);
  const r = optimizeRoute(scheduleInput(syn.ctx, syn.start, syn.inputs));
  await getDb().transaction(async (tx) => {
    let plan = syn.plan;
    if (isConfirmedRoute(plan.status)) {
      await setPlanStatus(tx, plan, 'DRAFT', actor);
      plan = { ...plan, status: 'DRAFT' };
    }
    await setPlanStatus(tx, plan, 'OPTIMIZED', actor, { optimizeMethod: 'AUTO', optimizedAt: new Date() });
    await persistStops(tx, plan, r.after, syn.jobs, syn.rows, actor);
  });
  return r;
}

/* ---------- F-TEC-RTE-03 확정 ---------- */

export async function confirmRoute(
  techId: number,
  date: string,
  actor: Actor = { type: 'TECHNICIAN', id: techId },
) {
  const syn = await syncPlan(techId, date, actor);
  if (!syn) throw new UserError('그날 코스가 없습니다.');
  if (isConfirmedRoute(syn.plan.status)) throw new UserError('이미 확정된 코스입니다.');
  const s = syn.schedule;
  const ok = canConfirmRoute(s);
  if (!ok.ok) throw new UserError(ok.message);
  const jobByKey = new Map(syn.jobs.map((j) => [jobKey(j.assignmentId), j]));
  const rowByKey = new Map(syn.rows.map((r) => [r.assignmentId ? jobKey(r.assignmentId) : stopKey(r.id), r]));
  const notices: { orderId: number; code: 'VISIT_TIME_NOTICE' | 'VISIT_TIME_CHANGED'; at: Date }[] = [];
  const notified = new Map<string, Date>();
  for (const st of s.stops) {
    const j = jobByKey.get(st.key);
    if (!j || j.role !== 'MAIN' || j.orderStatus !== 'ASSIGNED') continue;
    const prev = rowByKey.get(st.key)?.notifiedArrival ?? null;
    if (sameMinute(prev, st.arrival)) continue;
    notices.push({
      orderId: j.orderId,
      code: prev ? 'VISIT_TIME_CHANGED' : 'VISIT_TIME_NOTICE',
      at: st.arrival,
    });
    notified.set(st.key, st.arrival);
  }
  await getDb().transaction(async (tx) => {
    await setPlanStatus(tx, syn.plan, 'CONFIRMED', actor, {
      confirmedAt: new Date(),
      version: syn.plan.confirmedAt ? syn.plan.version + 1 : syn.plan.version,
    });
    await persistStops(tx, syn.plan, s, syn.jobs, syn.rows, actor, { notified });
    for (const st of s.stops) {
      const j = jobByKey.get(st.key);
      if (!j) continue;
      await tx
        .update(assignment)
        .set({ routeOrder: st.seq, updatedAt: new Date(), updatedBy: actor.id })
        .where(eq(assignment.id, j.assignmentId));
      // 고객에게 안내한 도착 허용 시간창을 주문에 남긴다 (처음 확정 때)
      if (j.role === 'MAIN' && !j.arrivalWindowStart && st.windowStart && st.windowEnd)
        await tx
          .update(serviceOrder)
          .set({
            arrivalWindowStart: st.windowStart,
            arrivalWindowEnd: st.windowEnd,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(and(eq(serviceOrder.id, j.orderId), isNull(serviceOrder.arrivalWindowStart)));
    }
  });
  const [t] = await getDb()
    .select({ name: technician.name, displayName: technician.displayName })
    .from(technician)
    .where(eq(technician.id, techId));
  for (const n of notices)
    await notifyOrder(n.code, n.orderId, {
      방문예정: `${formatVisitTime(n.at)} 전후`,
      기사명: t ? t.displayName || t.name : '',
    });
  return { notified: notices.length };
}

/** 마감 시 자동 확정: 추천 순서 적용 후 시간창 위반이 없으면 확정 (위반이 있으면 추천 순서만 적용하고 남김) */
export async function autoConfirm(
  techId: number,
  date: string,
): Promise<'CONFIRMED' | 'BLOCKED' | 'SKIPPED'> {
  const sys: Actor = { type: 'SYSTEM', id: null };
  const syn = await syncPlan(techId, date, sys);
  if (!syn || isConfirmedRoute(syn.plan.status)) return 'SKIPPED';
  if (changeWindowOpen(syn.plan)) return 'SKIPPED'; // 단계 9 승인된 변경은 기사가 직접 다시 확정
  if (!syn.schedule.stops.some((s) => s.type === 'JOB')) return 'SKIPPED';
  const r = await applyRecommendation(techId, date, sys);
  if (r.after.violations > 0) return 'BLOCKED';
  await confirmRoute(techId, date, sys);
  await notifyStaffWith(
    'ROUTE_AUTO_CONFIRMED',
    { type: 'TECHNICIAN', id: techId },
    { type: 'ROUTE_PLAN', id: syn.plan.id },
    { 코스일자: formatDateLabel(date) },
    `/tech/route?date=${date}`,
  );
  return 'CONFIRMED';
}

/* ---------- 배치 (F-SYS-15·16) ---------- */

/** 그날 확정 배정이 있는 기사 */
async function techsWithJobs(date: string): Promise<number[]> {
  const { from, to } = dayRange(date);
  const rows = await getDb()
    .selectDistinct({ id: assignment.technicianId })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .where(
      and(
        inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES]),
        notInArray(serviceOrder.status, ['CANCELED']),
        isNull(serviceOrder.deletedAt),
        gte(serviceOrder.promisedAt, from),
        lt(serviceOrder.promisedAt, to),
      ),
    );
  return rows.map((r) => r.id).filter((x): x is number => x !== null);
}

/** F-SYS-15 매일 15:00: 다음 날 코스 초안 + 자동 추천 순서, 기사에게 "내일 코스 확인" */
export async function createRouteDrafts(now = new Date()) {
  const date = addDays(kstDate(now), 1);
  let drafted = 0;
  for (const techId of await techsWithJobs(date)) {
    try {
      const syn = await syncPlan(techId, date);
      if (!syn) continue;
      if (syn.plan.status === 'DRAFT' && !syn.plan.optimizedAt)
        await applyRecommendation(techId, date, { type: 'SYSTEM', id: null });
      if (!isConfirmedRoute(syn.plan.status)) {
        await notifyStaffWith(
          'ROUTE_DRAFT_READY',
          { type: 'TECHNICIAN', id: techId },
          { type: 'ROUTE_PLAN', id: syn.plan.id },
          {
            코스일자: formatDateLabel(date),
            방문건수: String(syn.schedule.stops.filter((s) => s.type === 'JOB').length),
          },
          `/tech/route?date=${date}`,
        );
        drafted++;
      }
    } catch (e) {
      console.error('코스 초안 생성 실패', techId, date, e);
    }
  }
  return { date, drafted };
}

/** F-SYS-16 ① 마감 전 미확정 기사에게 알림 */
export async function remindUnconfirmed(now = new Date()) {
  const date = addDays(kstDate(now), 1);
  let reminded = 0;
  for (const techId of await techsWithJobs(date)) {
    const syn = await syncPlan(techId, date).catch(() => null);
    if (!syn || isConfirmedRoute(syn.plan.status) || isAfterDeadline(now, syn.ctx.deadline)) continue;
    await notifyStaffWith(
      'ROUTE_CONFIRM_REMIND',
      { type: 'TECHNICIAN', id: techId },
      { type: 'ROUTE_PLAN', id: syn.plan.id },
      { 코스일자: formatDateLabel(date) },
      `/tech/route?date=${date}`,
    );
    reminded++;
  }
  return { date, reminded };
}

/** F-SYS-16 ② 마감이 지난 미확정 코스 자동 확정 (오늘 + 마감이 지난 내일) */
export async function autoConfirmDue(now = new Date()) {
  const today = kstDate(now);
  const deadlineHm = await getSettingString(SETTING_KEYS.ROUTE_CONFIRM_DEADLINE);
  const dates = [today, addDays(today, 1)].filter((d) =>
    isAfterDeadline(now, routeConfirmDeadline(d, deadlineHm)),
  );
  const out = { confirmed: 0, blocked: 0 };
  for (const date of dates) {
    for (const techId of await techsWithJobs(date)) {
      try {
        const r = await autoConfirm(techId, date);
        if (r === 'CONFIRMED') out.confirmed++;
        if (r === 'BLOCKED') out.blocked++;
      } catch (e) {
        console.error('코스 자동 확정 실패', techId, date, e);
      }
    }
  }
  return { dates, ...out };
}

/* ---------- 자가 배정 미리보기용 (F-TEC-RTE-04) ---------- */

/** 그날 코스에 작업 하나를 넣을 때의 삽입 위치·이동시간 증가 (저장하지 않음) */
export async function insertionPreview(
  techId: number,
  date: string,
  job: {
    id: number;
    addressId: number;
    promisedAt: Date | null;
    arrivalWindowStart: Date | null;
    arrivalWindowEnd: Date | null;
  },
) {
  const db = getDb();
  const ctx = await dayContext(db, techId, date);
  const syn = await syncPlan(techId, date).catch(() => null);
  const [coords, info] = await Promise.all([ensureAddressCoords([job.addressId]), workInfo(db, [job.id])]);
  const point = coords.get(job.addressId);
  if (!point) return null;
  const w = arrivalWindowOf(job, ctx.windowHours);
  const stop: RouteStopInput = {
    key: `O${job.id}`,
    type: 'JOB',
    point,
    windowStart: w?.start ?? null,
    windowEnd: w?.end ?? null,
    workMin: info.get(job.id)?.workMin || 60,
    locked: false,
  };
  const start = syn?.start ?? ctx.branchPoint ?? point;
  const r = bestInsertion(scheduleInput(ctx, start, syn?.inputs ?? []), stop);
  return {
    position: r.position + 1,
    addedTravelMin: r.addedTravelMin,
    ok: r.ok,
    working: ctx.working,
    arrival: r.schedule.stops[r.position]!.arrival.toISOString(),
  };
}

/* ---------- C-ORD-020 방문 예정 시간 ---------- */

/** 고객 화면: 확정 코스의 안내 시각만 (좌표 없음, BR-115). 마감이 지났는데 미확정이면 먼저 자동 확정 */
export async function customerVisitInfo(orderId: number, now = new Date()) {
  const db = getDb();
  const [o] = await db
    .select({ status: serviceOrder.status, promisedAt: serviceOrder.promisedAt })
    .from(serviceOrder)
    .where(eq(serviceOrder.id, orderId));
  if (o?.status === 'ON_THE_WAY')
    return customerVisitTime({ orderStatus: o.status, routeStatus: null, notifiedArrival: null, eta: await customerEta(orderId) });
  if (!o || o.status !== 'ASSIGNED' || !o.promisedAt) return null;
  const [main] = await db
    .select({ techId: assignment.technicianId, assignmentId: assignment.id })
    .from(assignment)
    .where(
      and(
        eq(assignment.orderId, orderId),
        eq(assignment.role, 'MAIN'),
        inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES]),
      ),
    );
  if (!main?.techId) return null;
  const date = kstDate(o.promisedAt);
  const read = async () => {
    const [r] = await db
      .select({
        status: routePlan.status,
        deadline: routePlan.confirmDeadline,
        notified: routeStop.notifiedArrival,
      })
      .from(routeStop)
      .innerJoin(routePlan, eq(routePlan.id, routeStop.routePlanId))
      .where(
        and(
          eq(routeStop.assignmentId, main.assignmentId),
          eq(routePlan.technicianId, main.techId!),
          eq(routePlan.planDate, date),
        ),
      );
    return r ?? null;
  };
  let r = await read();
  const deadlineHm = await getSettingString(SETTING_KEYS.ROUTE_CONFIRM_DEADLINE);
  if (
    (!r || !isConfirmedRoute(r.status)) &&
    date >= kstDate(now) &&
    isAfterDeadline(now, routeConfirmDeadline(date, deadlineHm))
  ) {
    await autoConfirm(main.techId, date).catch((e) => console.error('코스 자동 확정 실패', e));
    r = await read();
  }
  return customerVisitTime({
    orderStatus: o.status,
    routeStatus: r?.status ?? null,
    notifiedArrival: r?.notified ?? null,
  });
}

/* ---------- 단계 5-1 현장작업 연동 (F-TEC-WRK-01·02·07) ---------- */

/** 확정 코스의 다음 방문지(아직 끝나지 않은 첫 작업)의 접수번호. 코스가 없거나 미확정이면 null */
export async function nextRouteOrderNo(techId: number, date: string): Promise<string | null> {
  const syn = await syncPlan(techId, date, { type: 'TECHNICIAN', id: techId });
  if (!syn || !isConfirmedRoute(syn.plan.status)) return null;
  const next = syn.rows.find((r) => r.stopType === 'JOB' && r.status !== 'DONE' && r.status !== 'SKIPPED');
  if (!next?.orderId) return null;
  return syn.jobs.find((j) => j.orderId === next.orderId)?.orderNo ?? null;
}

/**
 * 출발 시 도착 예정시각: 근무 중 마지막 위치(없으면 직전에 끝낸 방문지, 그것도 없으면 코스 출발지) → 방문지 이동시간.
 * 경로 API 실연동 전이라 직선거리 ÷ 25km/h(F-TEC-RTE-02 예외 규칙). 좌표를 모르면 null.
 */
export async function departureEta(
  techId: number,
  date: string,
  addressId: number,
  current: LatLng | null,
  now = new Date(),
): Promise<Date | null> {
  const dest = (await ensureAddressCoords([addressId])).get(addressId);
  if (!dest) return null;
  let origin = current;
  if (!origin) {
    const db = getDb();
    const [plan] = await db
      .select()
      .from(routePlan)
      .where(and(eq(routePlan.technicianId, techId), eq(routePlan.planDate, date)));
    if (plan) {
      const done = await db
        .select({ lat: routeStop.lat, lng: routeStop.lng })
        .from(routeStop)
        .where(and(eq(routeStop.routePlanId, plan.id), eq(routeStop.stopType, 'JOB'), eq(routeStop.status, 'DONE')))
        .orderBy(sql`${routeStop.actualDeparture} DESC NULLS LAST`)
        .limit(1);
      origin = toLatLng(done[0]?.lat ?? null, done[0]?.lng ?? null) ?? toLatLng(plan.startLat, plan.startLng);
    }
  }
  if (!origin) return null;
  return new Date(now.getTime() + travel(origin, dest).minutes * 60_000);
}

/**
 * 현장작업 이벤트를 코스 지점에 남긴다: 출발 = 도착 예정(eta)·코스 진행중, 도착 = 실제 도착, 완료 = 실제 출발·지점 완료(모두 끝나면 코스 완료).
 * 코스 상태 변경은 assertRouteTransition 을 거친다(01 §3.6). 코스가 없으면 아무것도 하지 않는다.
 */
export async function markRouteStop(
  tx: Tx,
  techId: number,
  orderId: number,
  date: string,
  event: { type: 'DEPART'; eta: Date | null } | { type: 'ARRIVE' } | { type: 'DONE' } | { type: 'SKIP' },
  at = new Date(),
) {
  const [plan] = await tx
    .select()
    .from(routePlan)
    .where(and(eq(routePlan.technicianId, techId), eq(routePlan.planDate, date)));
  if (!plan) return;
  const [stop] = await tx
    .select()
    .from(routeStop)
    .where(and(eq(routeStop.routePlanId, plan.id), eq(routeStop.orderId, orderId)));
  const actor: Actor = { type: 'TECHNICIAN', id: techId };
  if (stop) {
    const set =
      event.type === 'DEPART'
        ? { eta: event.eta, etaUpdatedAt: event.eta ? at : null }
        : event.type === 'ARRIVE'
          ? { actualArrival: at, status: 'ARRIVED' }
          : event.type === 'SKIP'
            ? { actualDeparture: stop.actualArrival ? at : null, status: 'SKIPPED' } // 단계 5-2 미처리
            : { actualDeparture: at, status: 'DONE', actualArrival: stop.actualArrival ?? at };
    await tx.update(routeStop).set({ ...set, updatedAt: at, updatedBy: techId }).where(eq(routeStop.id, stop.id));
  }
  if (event.type === 'DEPART' && plan.status === 'CONFIRMED') await setPlanStatus(tx, plan, 'IN_PROGRESS', actor);
  if ((event.type === 'DONE' || event.type === 'SKIP') && plan.status === 'IN_PROGRESS') {
    const open = await tx
      .select({ id: routeStop.id })
      .from(routeStop)
      .where(
        and(
          eq(routeStop.routePlanId, plan.id),
          eq(routeStop.stopType, 'JOB'),
          notInArray(routeStop.status, ['DONE', 'SKIPPED']),
        ),
      )
      .limit(1);
    if (!open.length) await setPlanStatus(tx, plan, 'DONE', actor);
  }
}

/** 이동중 주문의 도착 예정시각 (고객 C-ORD-020, 좌표 없음 BR-115) */
export async function customerEta(orderId: number): Promise<Date | null> {
  const [r] = await getDb()
    .select({ eta: routeStop.eta })
    .from(routeStop)
    .innerJoin(routePlan, eq(routePlan.id, routeStop.routePlanId))
    .where(eq(routeStop.orderId, orderId))
    .orderBy(sql`${routeStop.etaUpdatedAt} DESC NULLS LAST`)
    .limit(1);
  return r?.eta ?? null;
}

