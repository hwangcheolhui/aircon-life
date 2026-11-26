import 'server-only';
/**
 * 코스 모니터링·변경 승인·진행 중 ETA (단계 9).
 * - A-DSP-070 코스 모니터링(F-ADM-DSP-09): 거점 기사들의 그날 코스·현재 위치·지연 지점, 마감 후 코스 변경 요청 승인/반려
 * - T-RTE-010 코스 변경 요청: 확정 마감이 지난 확정 코스를 바꿔야 할 때 기사가 사유와 함께 요청(BR-113)
 * - F-TEC-RTE-06 · F-SYS-17 진행 중 ETA 재계산: 위치 기록·작업 완료 이벤트 때 남은 정류장 ETA 갱신(route_stop.eta).
 *   Vercel Hobby 는 크론이 하루 1회라 "근무 중 5분" 주기 대신 이벤트로만 돈다. 다음 고객이 ETA_DELAY_ALERT_MIN 이상 늦으면
 *   기사에게 하루 1회 알림(ETA_DELAY_TECH), 기사가 확인하고 [고객에게 지연 안내](VISIT_DELAY)를 보낸다(BR-115 시각만).
 */
import { assignment, branch, customer, routePlan, routeStop, serviceOrder, technician, technicianLocation, workOrder } from '@aircon/db';
import {
  type BranchFilter,
  type LatLng,
  SETTING_KEYS,
  busyUntilOf,
  kstDate,
  maskName,
  nextStopDelay,
  recalcEtas,
  shortAddress,
} from '@aircon/domain';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { formatClock, formatDateLabel } from '@/customer/format';
import { UserError } from './action-result';
import { getDb } from './db';
import { toLatLng } from './geo';
import { alreadyNotifiedRelated, notifyOrder, notifyStaffWith } from './notify';
import type { Actor } from './orders';
import { decrypt } from './pii';
import { changeWindowOpen } from './route-plans';
import { getSettingNumber } from './settings';
import { assertInScope, scopeCond } from './voc';

const OPEN_STOP = ['PLANNED'];

/* ---------- 코스 변경 요청 (기사) ---------- */

export async function requestRouteChange(techId: number, date: string, note: string, now = new Date()) {
  const db = getDb();
  const [plan] = await db.select().from(routePlan).where(and(eq(routePlan.technicianId, techId), eq(routePlan.planDate, date)));
  if (!plan) throw new UserError('그날 코스가 없습니다.');
  if (!['CONFIRMED', 'IN_PROGRESS'].includes(plan.status)) throw new UserError('확정된 코스만 변경을 요청할 수 있습니다. 아직 확정 전이면 직접 바꿔 주세요.');
  if (plan.changeRequestStatus === 'REQUESTED') throw new UserError('이미 요청했습니다. 거점 확인을 기다려 주세요.');
  if (changeWindowOpen(plan)) throw new UserError('이미 승인됐습니다. 코스를 바꾼 뒤 다시 확정해 주세요.');
  await db
    .update(routePlan)
    .set({ changeRequestStatus: 'REQUESTED', changeRequestNote: note, changeRequestedAt: now, changeHandledBy: null, changeHandledAt: null, changeHandleNote: null, updatedAt: now, updatedBy: techId })
    .where(eq(routePlan.id, plan.id));
  const [t] = await db.select({ name: technician.name }).from(technician).where(eq(technician.id, techId));
  await notifyStaffWith('ROUTE_CHANGE_REQUESTED', { type: 'ADMIN', id: null }, { type: 'ROUTE_PLAN', id: plan.id }, { 기사명: t?.name ?? '', 코스일자: formatDateLabel(date), 사유: note }, `/admin/dsp/monitor?date=${date}`);
}

/* ---------- 변경 승인·반려 (A-DSP-070) ---------- */

export async function decideRouteChange(planId: number, approve: boolean, note: string | null, filter: BranchFilter, actor: Actor, now = new Date()) {
  const db = getDb();
  const [row] = await db
    .select({ plan: routePlan, branchId: technician.branchId })
    .from(routePlan)
    .innerJoin(technician, eq(technician.id, routePlan.technicianId))
    .where(eq(routePlan.id, planId));
  if (!row) throw new UserError('코스를 찾을 수 없습니다.');
  assertInScope(filter, row.branchId);
  if (row.plan.changeRequestStatus !== 'REQUESTED') throw new UserError('처리할 변경 요청이 없습니다.');
  if (!approve && !note?.trim()) throw new UserError('반려 사유는(는) 필수 입력값입니다.');
  const updated = await db
    .update(routePlan)
    .set({ changeRequestStatus: approve ? 'APPROVED' : 'REJECTED', changeHandledBy: actor.id, changeHandledAt: now, changeHandleNote: note, updatedAt: now, updatedBy: actor.id })
    .where(and(eq(routePlan.id, planId), eq(routePlan.changeRequestStatus, 'REQUESTED')))
    .returning({ id: routePlan.id });
  if (!updated.length) throw new UserError('다른 곳에서 먼저 처리했습니다.');
  await notifyStaffWith(
    approve ? 'ROUTE_CHANGE_APPROVED' : 'ROUTE_CHANGE_REJECTED',
    { type: 'TECHNICIAN', id: row.plan.technicianId },
    { type: 'ROUTE_PLAN', id: planId },
    { 코스일자: formatDateLabel(row.plan.planDate), 사유: note ?? '' },
    `/tech/route?date=${row.plan.planDate}`,
  );
}

/* ---------- 진행 중 ETA (F-TEC-RTE-06, F-SYS-17) ---------- */

async function latestPoint(techId: number, since: Date): Promise<LatLng | null> {
  const [l] = await getDb()
    .select({ lat: technicianLocation.lat, lng: technicianLocation.lng })
    .from(technicianLocation)
    .where(and(eq(technicianLocation.technicianId, techId), gte(technicianLocation.recordedAt, since)))
    .orderBy(desc(technicianLocation.recordedAt))
    .limit(1);
  return l ? toLatLng(l.lat, l.lng) : null;
}

/**
 * 오늘 코스의 남은 정류장 ETA 를 다시 계산해 저장한다. 다음 고객 지연이 임계값 이상이면 기사에게 알린다(그 주문에 하루 1회).
 * 실패해도 위치 기록·작업 완료는 막지 않는다.
 */
export async function refreshEtas(techId: number, now = new Date()) {
  try {
    const db = getDb();
    const today = kstDate(now);
    const [plan] = await db.select().from(routePlan).where(and(eq(routePlan.technicianId, techId), eq(routePlan.planDate, today)));
    if (!plan || !['CONFIRMED', 'IN_PROGRESS'].includes(plan.status)) return null;
    const stops = await db.select().from(routeStop).where(eq(routeStop.routePlanId, plan.id)).orderBy(asc(routeStop.stopSeq));
    // 진행 중 작업(도착~작업중) → 그 자리에서 예상 종료 후 출발
    const active = stops.find((s) => s.status === 'ARRIVED');
    let busyUntil: Date | null = null;
    let origin: LatLng | null = null;
    if (active?.orderId) {
      const [w] = await db.select({ startedAt: workOrder.startedAt, arrivedAt: workOrder.arrivedAt }).from(workOrder).where(eq(workOrder.orderId, active.orderId));
      busyUntil = busyUntilOf(w?.startedAt ?? w?.arrivedAt ?? active.actualArrival, active.workMin ?? 0, now);
      origin = toLatLng(active.lat, active.lng);
    } else {
      origin = await latestPoint(techId, new Date(now.getTime() - 30 * 60_000));
    }
    const remaining = stops.filter((s) => OPEN_STOP.includes(s.status) && (!active || s.stopSeq > active.stopSeq));
    if (!remaining.length) return null;
    const bufferMin = await getSettingNumber(SETTING_KEYS.ROUTE_TRAVEL_BUFFER_MIN);
    const etas = recalcEtas({
      now,
      origin,
      busyUntil,
      bufferMin,
      stops: remaining.map((s) => ({
        id: s.id,
        point: s.stopType === 'BREAK' ? null : toLatLng(s.lat, s.lng),
        workMin: s.workMin ?? 0,
        windowStart: s.windowStart,
        plannedArrival: s.plannedArrival,
        notifiedArrival: s.notifiedArrival,
      })),
    });
    for (const e of etas) await db.update(routeStop).set({ eta: e.eta, etaUpdatedAt: now }).where(eq(routeStop.id, e.id));
    const jobEtas = etas.filter((e) => remaining.find((s) => s.id === e.id)?.stopType === 'JOB');
    const threshold = await getSettingNumber(SETTING_KEYS.ETA_DELAY_ALERT_MIN);
    const late = nextStopDelay(jobEtas, threshold);
    if (late) {
      const stop = remaining.find((s) => s.id === late.id)!;
      if (stop.orderId && !(await alreadyNotifiedRelated('ETA_DELAY_TECH', 'ORDER', stop.orderId))) {
        const [o] = await db.select({ orderNo: serviceOrder.orderNo }).from(serviceOrder).where(eq(serviceOrder.id, stop.orderId));
        await notifyStaffWith(
          'ETA_DELAY_TECH',
          { type: 'TECHNICIAN', id: techId },
          { type: 'ORDER', id: stop.orderId },
          { 접수번호: o?.orderNo ?? '', 지연분: String(late.delayMin), 도착예정: formatClock(late.eta) },
          `/tech/route?date=${today}`,
        );
      }
    }
    return { updated: etas.length, late: late ? { stopId: late.id, delayMin: late.delayMin } : null };
  } catch (e) {
    console.error('ETA 재계산 실패', techId, e);
    return null;
  }
}

/** 기사 확인 후 고객 지연 안내(VISIT_DELAY): 새 도착 예정 시각을 안내 시각으로 남긴다 */
export async function sendVisitDelay(techId: number, orderNo: string, now = new Date()) {
  const db = getDb();
  const [row] = await db
    .select({ stop: routeStop, orderId: serviceOrder.id, status: serviceOrder.status })
    .from(routeStop)
    .innerJoin(routePlan, eq(routePlan.id, routeStop.routePlanId))
    .innerJoin(serviceOrder, eq(serviceOrder.id, routeStop.orderId))
    .innerJoin(assignment, eq(assignment.id, routeStop.assignmentId))
    .where(and(eq(serviceOrder.orderNo, orderNo), eq(routePlan.technicianId, techId), eq(routePlan.planDate, kstDate(now)), eq(assignment.role, 'MAIN')));
  if (!row) throw new UserError('오늘 내 코스의 주기사 작업만 안내할 수 있습니다.');
  if (!row.stop.eta || !OPEN_STOP.includes(row.stop.status)) throw new UserError('도착 예정 시각이 없습니다.');
  await db.update(routeStop).set({ notifiedArrival: row.stop.eta, updatedAt: now, updatedBy: techId }).where(eq(routeStop.id, row.stop.id));
  await notifyOrder('VISIT_DELAY', row.orderId, { 도착예정: formatClock(row.stop.eta) });
  return { eta: row.stop.eta };
}

/* ---------- A-DSP-070 모니터링 화면 ---------- */

export async function monitorBoard(filter: BranchFilter, date: string, now = new Date()) {
  const db = getDb();
  const plans = await db
    .select({ plan: routePlan, techName: technician.name, branchId: technician.branchId, branchName: branch.name })
    .from(routePlan)
    .innerJoin(technician, eq(technician.id, routePlan.technicianId))
    .leftJoin(branch, eq(branch.id, technician.branchId))
    .where(and(eq(routePlan.planDate, date), scopeCond(filter, technician.branchId)))
    .orderBy(asc(technician.name));
  const ids = plans.map((p) => p.plan.id);
  const stops = ids.length
    ? await db
        .select({ s: routeStop, orderNo: serviceOrder.orderNo, orderStatus: serviceOrder.status, customerName: customer.name, roadAddress: sql<string | null>`(select road_address from customer_address where id = ${serviceOrder.addressId})` })
        .from(routeStop)
        .leftJoin(serviceOrder, eq(serviceOrder.id, routeStop.orderId))
        .leftJoin(customer, eq(customer.id, serviceOrder.customerId))
        .where(inArray(routeStop.routePlanId, ids))
        .orderBy(asc(routeStop.routePlanId), asc(routeStop.stopSeq))
    : [];
  const threshold = await getSettingNumber(SETTING_KEYS.ETA_DELAY_ALERT_MIN);
  const techIds = plans.map((p) => p.plan.technicianId);
  const since = new Date(`${date}T00:00:00+09:00`);
  const locs = techIds.length && date === kstDate(now)
    ? await db
        .selectDistinctOn([technicianLocation.technicianId], { techId: technicianLocation.technicianId, lat: technicianLocation.lat, lng: technicianLocation.lng, at: technicianLocation.recordedAt })
        .from(technicianLocation)
        .where(and(inArray(technicianLocation.technicianId, techIds), gte(technicianLocation.recordedAt, since)))
        .orderBy(technicianLocation.technicianId, desc(technicianLocation.recordedAt))
    : [];
  return plans.map((p) => {
    const mine = stops.filter((x) => x.s.routePlanId === p.plan.id);
    const loc = locs.find((l) => l.techId === p.plan.technicianId);
    return {
      planId: p.plan.id,
      techId: p.plan.technicianId,
      techName: p.techName,
      branchName: p.branchName,
      status: p.plan.status,
      version: p.plan.version,
      confirmedAt: p.plan.confirmedAt,
      change: p.plan.changeRequestStatus
        ? { status: p.plan.changeRequestStatus, note: p.plan.changeRequestNote, requestedAt: p.plan.changeRequestedAt, handleNote: p.plan.changeHandleNote }
        : null,
      location: loc ? { ...toLatLng(loc.lat, loc.lng)!, at: loc.at } : null,
      stops: mine.map((x) => {
        const ref = x.s.notifiedArrival ?? x.s.plannedArrival;
        const delayMin = x.s.eta && ref && x.s.status === 'PLANNED' ? Math.round((x.s.eta.getTime() - ref.getTime()) / 60_000) : null;
        return {
          id: x.s.id,
          seq: x.s.stopSeq,
          type: x.s.stopType,
          status: x.s.status,
          orderNo: x.orderNo,
          orderStatus: x.orderStatus,
          customerName: x.customerName ? maskName(decrypt(x.customerName)) : null,
          address: x.roadAddress ? shortAddress(x.roadAddress) : null,
          point: toLatLng(x.s.lat, x.s.lng),
          plannedArrival: x.s.plannedArrival,
          notifiedArrival: x.s.notifiedArrival,
          eta: x.s.eta,
          actualArrival: x.s.actualArrival,
          actualDeparture: x.s.actualDeparture,
          delayMin,
          late: delayMin !== null && delayMin >= threshold,
          violation: x.s.windowViolation,
        };
      }),
    };
  });
}
