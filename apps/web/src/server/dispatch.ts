import 'server-only';
/**
 * 배정·재배정·이관 서버 서비스 (단계 4-1: F-ADM-DSP-01·03·04, F-TEC-JOB-05, F-SYS-09).
 * - 배정 검증은 packages/domain 의 checkTechForRole·checkAssignmentPlan 하나로 한다(BR-070·071·072, 2인 작업).
 *   막는 규칙(BLOCK)은 저장하지 않고, 경고(WARN)는 운영자가 확인(confirmWarnings)해야 저장한다.
 * - 배정 상태 변경은 transitionAssignment() 하나로만: 전이 검사 + 조건부 UPDATE + assignment_history 1행(INSERT ONLY).
 * - 주문 상태 변경은 orders.transitionOrder() (RECEIVED/ASSIGN_WAIT → ASSIGNED, 배정 취소 시 ASSIGNED → ASSIGN_WAIT).
 * - 배정·변경 후 기사 앱 알림(TECH_JOB_*)과 고객 "기사 배정" 알림(TECH_ASSIGNED)을 보낸다(트랜잭션 밖, 실패해도 배정 유지).
 * 거점 범위(BR-102)는 주문의 branch_id 로 확인한다.
 */
import {
  assignment,
  assignmentHistory,
  branch,
  customer,
  customerAddress,
  orderItem,
  serviceOrder,
  serviceProduct,
  technician,
  technicianArea,
  technicianSkill,
  timeSlot,
  workSchedule,
} from '@aircon/db';
import {
  type AssignAction,
  type AssignIssue,
  type AssignRole,
  type AssignStatus,
  type AssignTech,
  type BranchFilter,
  ACTIVE_ASSIGN_STATUSES,
  ACTIVE_ORDER_STATUSES,
  CONFIRMED_ASSIGN_STATUSES,
  SETTING_KEYS,
  assertAssignTransition,
  blocking,
  checkAssignmentPlan,
  checkTechForRole,
  hoursOf,
  isUnassignedUrgent,
  MSG,
  maskName,
  needsAccompany,
  shortAddress,
} from '@aircon/domain';
import { and, asc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { UserError } from './action-result';
import { ForbiddenError } from './auth';
import { getDb } from './db';
import { alreadyNotified, notifyOrder, notifyStaff } from './notify';
import { type Actor, type Tx, transitionOrder } from './orders';
import { decrypt } from './pii';
import { getSettingNumber, getSettingString } from './settings';

type Db = ReturnType<typeof getDb>;

const dayRange = (date: string) => {
  const from = new Date(`${date}T00:00:00+09:00`);
  return { from, to: new Date(from.getTime() + 24 * 3600_000) };
};

/** 주문 약속 시작·종료 (requested_time_to 가 없으면 1시간) */
export function orderWindow(o: { requestedDate: string | null; requestedTimeTo: string | null; promisedAt: Date | null }) {
  if (!o.promisedAt) return null;
  const end = o.requestedDate && o.requestedTimeTo ? new Date(`${o.requestedDate}T${o.requestedTimeTo.slice(0, 5)}:00+09:00`) : new Date(o.promisedAt.getTime() + 3600_000);
  return { start: o.promisedAt, end: end > o.promisedAt ? end : new Date(o.promisedAt.getTime() + 3600_000) };
}

function assertOrderInScope(o: { branchId: number }, filter: BranchFilter) {
  if (filter.kind === 'NONE' || (filter.kind === 'BRANCH' && filter.branchId !== o.branchId)) throw new ForbiddenError('다른 거점의 주문입니다.');
}

/* ---------- 배정 상태 전이 (01 §3.10) ---------- */

async function transitionAssignment(
  tx: Tx,
  a: { id: number; status: string; orderId: number; technicianId: number | null },
  to: AssignStatus,
  history: { action: AssignAction; toTechnicianId?: number | null; reason: string | null },
  actor: Actor,
  set: Partial<typeof assignment.$inferInsert> = {},
) {
  assertAssignTransition(a.status, to);
  const rows = await tx
    .update(assignment)
    .set({ ...set, status: to, updatedAt: new Date(), updatedBy: actor.id })
    .where(and(eq(assignment.id, a.id), eq(assignment.status, a.status)))
    .returning({ id: assignment.id });
  if (rows.length === 0) throw new UserError('다른 곳에서 먼저 처리된 배정입니다. 새로고침 후 다시 확인해 주세요.');
  await tx.insert(assignmentHistory).values({
    orderId: a.orderId,
    fromTechnicianId: a.technicianId,
    toTechnicianId: history.toTechnicianId ?? null,
    action: history.action,
    reason: history.reason,
    actorType: actor.type,
    actorId: actor.id,
  });
}

/* ---------- 검증 재료 ---------- */

async function loadAssignTechs(db: Db | Tx, ids: number[]): Promise<Map<number, AssignTech & { branchId: number; deleted: boolean }>> {
  if (ids.length === 0) return new Map();
  const [techs, skills, areas] = await Promise.all([
    db.select().from(technician).where(inArray(technician.id, ids)),
    db.select().from(technicianSkill).where(inArray(technicianSkill.technicianId, ids)),
    db.select().from(technicianArea).where(inArray(technicianArea.technicianId, ids)),
  ]);
  return new Map(
    techs.map((t) => [
      t.id,
      {
        id: t.id,
        name: t.displayName || t.name,
        status: t.status,
        grade: t.grade,
        accompanyRequiredCount: t.accompanyRequiredCount,
        accompanyDoneCount: t.accompanyDoneCount,
        skills: skills.filter((s) => s.technicianId === t.id),
        areaCodes: areas.filter((a) => a.technicianId === t.id).map((a) => a.legalDongCode),
        branchId: t.branchId,
        deleted: t.deletedAt !== null,
      },
    ]),
  );
}

/** 기사별 그날 다른 약속 (이 주문 제외) */
async function busyByTech(db: Db | Tx, techIds: number[], date: string, exceptOrderId: number | null) {
  const out = new Map<number, { orderNo: string; start: Date; end: Date }[]>();
  if (techIds.length === 0) return out;
  const { from, to } = dayRange(date);
  const rows = await db
    .select({ technicianId: assignment.technicianId, start: assignment.scheduledStart, end: assignment.scheduledEnd, orderNo: serviceOrder.orderNo })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .where(
      and(
        inArray(assignment.technicianId, techIds),
        inArray(assignment.status, [...ACTIVE_ASSIGN_STATUSES]),
        inArray(serviceOrder.status, [...ACTIVE_ORDER_STATUSES]),
        gte(assignment.scheduledStart, from),
        lt(assignment.scheduledStart, to),
        exceptOrderId ? ne(assignment.orderId, exceptOrderId) : undefined,
      ),
    );
  for (const r of rows) {
    if (!r.technicianId || !r.start) continue;
    const list = out.get(r.technicianId) ?? [];
    list.push({ orderNo: r.orderNo, start: r.start, end: r.end ?? new Date(r.start.getTime() + 3600_000) });
    out.set(r.technicianId, list);
  }
  return out;
}

export async function orderDeviceTypes(db: Db | Tx, orderIds: number[]) {
  const out = new Map<number, { deviceType: string; name: string; quantity: number }[]>();
  if (orderIds.length === 0) return out;
  const rows = await db
    .select({ orderId: orderItem.orderId, deviceType: serviceProduct.deviceType, name: serviceProduct.name, quantity: orderItem.quantity })
    .from(orderItem)
    .innerJoin(serviceProduct, eq(serviceProduct.id, orderItem.productId))
    .where(and(inArray(orderItem.orderId, orderIds), eq(orderItem.itemType, 'PRODUCT')));
  for (const r of rows) out.set(r.orderId, [...(out.get(r.orderId) ?? []), { deviceType: r.deviceType, name: r.name, quantity: r.quantity }]);
  return out;
}

async function loadOrderForAssign(db: Db | Tx, orderId: number) {
  const [row] = await db
    .select({ o: serviceOrder, legalDongCode: customerAddress.legalDongCode })
    .from(serviceOrder)
    .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
    .where(and(eq(serviceOrder.id, orderId), isNull(serviceOrder.deletedAt)));
  if (!row) throw new UserError('주문을 찾을 수 없습니다.');
  const w = orderWindow(row.o);
  if (!w || !row.o.requestedDate) throw new UserError('약속 일시가 없는 주문은 배정할 수 없습니다.');
  return { order: row.o, legalDongCode: row.legalDongCode, window: w, date: row.o.requestedDate };
}

/** 배정 계획 전체 검증: 역할별 기사 검증 + 계획 검증 */
async function validatePlan(
  db: Db | Tx,
  ctx: Awaited<ReturnType<typeof loadOrderForAssign>>,
  plan: { role: AssignRole; technicianId: number }[],
): Promise<AssignIssue[]> {
  const ids = plan.map((p) => p.technicianId);
  const [techs, busy, devices, schedules, bufferMin, defaultStart, defaultEnd] = await Promise.all([
    loadAssignTechs(db, ids),
    busyByTech(db, ids, ctx.date, ctx.order.id),
    orderDeviceTypes(db, [ctx.order.id]),
    db.select().from(workSchedule).where(and(inArray(workSchedule.technicianId, ids), eq(workSchedule.workDate, ctx.date))),
    getSettingNumber(SETTING_KEYS.ASSIGN_TRAVEL_BUFFER_MIN),
    getSettingString(SETTING_KEYS.WORK_DEFAULT_START),
    getSettingString(SETTING_KEYS.WORK_DEFAULT_END),
  ]);
  const order = {
    deviceTypes: (devices.get(ctx.order.id) ?? []).map((d) => d.deviceType),
    legalDongCode: ctx.legalDongCode,
    start: ctx.window.start,
    end: ctx.window.end,
    requiredTechCount: ctx.order.requiredTechCount,
  };
  const issues: AssignIssue[] = [];
  for (const p of plan) {
    const t = techs.get(p.technicianId);
    if (!t || t.deleted) throw new UserError('기사를 찾을 수 없습니다.');
    if (t.branchId !== ctx.order.branchId) throw new UserError(`${t.name} 기사는 이 주문의 거점 소속이 아닙니다.`);
    const s = schedules.find((x) => x.technicianId === t.id) ?? null;
    issues.push(...checkTechForRole({ tech: t, role: p.role, order, schedule: s, busy: busy.get(t.id) ?? [], bufferMin, defaults: { defaultStart, defaultEnd } }));
  }
  const pick = (r: AssignRole) => {
    const p = plan.find((x) => x.role === r);
    return p ? techs.get(p.technicianId)! : null;
  };
  if (pick('MAIN')) issues.push(...checkAssignmentPlan({ order, main: pick('MAIN')!, support: pick('SUPPORT'), accompany: pick('ACCOMPANY') }));
  return issues;
}

export type AssignOutcome = { saved: true } | { saved: false; warnings: AssignIssue[] };

function decide(issues: AssignIssue[], confirmWarnings: boolean): AssignOutcome | null {
  const block = blocking(issues);
  if (block.length) throw new UserError(block.map((b) => b.message).join('\n'));
  const warnings = issues.filter((i) => i.level === 'WARN');
  if (warnings.length && !confirmWarnings) return { saved: false, warnings };
  return null;
}

export async function slotIdFor(tx: Tx, o: typeof serviceOrder.$inferSelect) {
  if (!o.requestedDate || !o.requestedTimeFrom) return null;
  const [s] = await tx
    .select({ id: timeSlot.id })
    .from(timeSlot)
    .where(and(eq(timeSlot.branchId, o.branchId), eq(timeSlot.slotDate, o.requestedDate), eq(timeSlot.slotHour, Number(o.requestedTimeFrom.slice(0, 2))), eq(timeSlot.slotKind, 'NORMAL')));
  return s?.id ?? null;
}

const activeAssignments = (db: Db | Tx, orderId: number) =>
  db
    .select()
    .from(assignment)
    .where(and(eq(assignment.orderId, orderId), inArray(assignment.status, [...ACTIVE_ASSIGN_STATUSES])));

async function techDisplayName(id: number) {
  const [t] = await getDb().select({ name: technician.name, displayName: technician.displayName }).from(technician).where(eq(technician.id, id));
  return t ? t.displayName || t.name : '';
}

const jobLink = (orderNo: string) => `/tech/jobs/${orderNo}`;

/** BR-111 배정 시점에 기사 관할(technician_area) 안이었는지 → assignment.in_zone (운영자 배정은 관할 밖도 가능, 경고만) */
async function inZoneOf(db: Db | Tx, techId: number, legalDongCode: string | null) {
  if (!legalDongCode) return false;
  const [hit] = await db
    .select({ code: technicianArea.legalDongCode })
    .from(technicianArea)
    .where(and(eq(technicianArea.technicianId, techId), eq(technicianArea.legalDongCode, legalDongCode)));
  return Boolean(hit);
}

/* ---------- F-ADM-DSP-01·03 배정 ---------- */

export async function assignOrder(
  input: { orderId: number; mainTechId: number; supportTechId: number | null; accompanyTechId: number | null; confirmWarnings: boolean },
  filter: BranchFilter,
  actor: Actor,
): Promise<AssignOutcome> {
  const db = getDb();
  const ctx = await loadOrderForAssign(db, input.orderId);
  assertOrderInScope(ctx.order, filter);
  if (!['RECEIVED', 'ASSIGN_WAIT'].includes(ctx.order.status)) throw new UserError('배정대기 상태의 주문만 배정할 수 있습니다. 이미 배정된 주문은 재배정을 쓰세요.');
  const plan: { role: AssignRole; technicianId: number }[] = [
    { role: 'MAIN', technicianId: input.mainTechId },
    ...(input.supportTechId ? [{ role: 'SUPPORT' as const, technicianId: input.supportTechId }] : []),
    ...(input.accompanyTechId ? [{ role: 'ACCOMPANY' as const, technicianId: input.accompanyTechId }] : []),
  ];
  const early = decide(await validatePlan(db, ctx, plan), input.confirmWarnings);
  if (early) return early;
  await db.transaction(async (tx) => {
    const live = await activeAssignments(tx, ctx.order.id);
    if (live.some((a) => a.status === 'REQUESTED')) throw new UserError('기사가 이 작업의 자가 배정을 요청해 승인 대기 중입니다. 재배정·이관 화면의 [자가 배정 요청] 탭에서 먼저 처리하세요.');
    if (live.length) throw new UserError('이미 배정된 주문입니다. 새로고침 후 다시 확인해 주세요.');
    const slotId = await slotIdFor(tx, ctx.order);
    for (const p of plan) {
      await tx.insert(assignment).values({
        orderId: ctx.order.id,
        technicianId: p.technicianId,
        role: p.role,
        timeSlotId: slotId,
        scheduledStart: ctx.window.start,
        scheduledEnd: ctx.window.end,
        assignMethod: 'MANUAL',
        status: 'ACCEPTED',
        inZone: await inZoneOf(tx, p.technicianId, ctx.legalDongCode),
        assignedBy: actor.type === 'ADMIN' ? actor.id : null,
        acceptedAt: new Date(),
        createdBy: actor.id,
        updatedBy: actor.id,
      });
      await tx.insert(assignmentHistory).values({ orderId: ctx.order.id, fromTechnicianId: null, toTechnicianId: p.technicianId, action: 'ASSIGN', reason: '배정 보드', actorType: actor.type, actorId: actor.id });
    }
    await transitionOrder(tx, ctx.order, 'ASSIGNED', actor, { memo: '배정 보드 배정' });
  });
  for (const p of plan) await notifyStaff('TECH_JOB_ASSIGNED', { type: 'TECHNICIAN', id: p.technicianId }, ctx.order.id, jobLink(ctx.order.orderNo));
  await notifyOrder('TECH_ASSIGNED', ctx.order.id, { 기사명: await techDisplayName(input.mainTechId) });
  return { saved: true };
}

/** 배정 전 미리보기 (모달에서 경고 확인용) */
export async function previewAssign(input: { orderId: number; mainTechId: number; supportTechId: number | null; accompanyTechId: number | null }, filter: BranchFilter) {
  const db = getDb();
  const ctx = await loadOrderForAssign(db, input.orderId);
  assertOrderInScope(ctx.order, filter);
  const plan: { role: AssignRole; technicianId: number }[] = [
    { role: 'MAIN', technicianId: input.mainTechId },
    ...(input.supportTechId ? [{ role: 'SUPPORT' as const, technicianId: input.supportTechId }] : []),
    ...(input.accompanyTechId ? [{ role: 'ACCOMPANY' as const, technicianId: input.accompanyTechId }] : []),
  ];
  return validatePlan(db, ctx, plan);
}

/* ---------- 배정 취소 (ASSIGNED → ASSIGN_WAIT) ---------- */

export async function unassignOrder(input: { orderId: number; reason: string }, filter: BranchFilter, actor: Actor) {
  const db = getDb();
  const ctx = await loadOrderForAssign(db, input.orderId);
  assertOrderInScope(ctx.order, filter);
  if (ctx.order.status !== 'ASSIGNED') throw new UserError('배정완료 상태의 주문만 배정을 취소할 수 있습니다.');
  const list = await activeAssignments(db, ctx.order.id);
  await db.transaction(async (tx) => {
    for (const a of list) await transitionAssignment(tx, a, 'CANCELED', { action: 'UNASSIGN', reason: input.reason }, actor);
    await transitionOrder(tx, ctx.order, 'ASSIGN_WAIT', actor, { memo: `배정 취소: ${input.reason}` });
  });
  for (const a of list) if (a.technicianId) await notifyStaff('TECH_JOB_CHANGED', { type: 'TECHNICIAN', id: a.technicianId }, ctx.order.id);
}

/* ---------- F-ADM-DSP-04 재배정 · 이관 승인/반려 ---------- */

async function replaceTech(
  orderId: number,
  fromAssignmentId: number,
  toTechId: number,
  action: 'REASSIGN' | 'TRANSFER',
  reason: string | null,
  confirmWarnings: boolean,
  filter: BranchFilter,
  actor: Actor,
): Promise<AssignOutcome> {
  const db = getDb();
  const ctx = await loadOrderForAssign(db, orderId);
  assertOrderInScope(ctx.order, filter);
  if (ctx.order.status !== 'ASSIGNED') throw new UserError('배정완료 상태의 주문만 기사를 바꿀 수 있습니다.');
  const [old] = await db.select().from(assignment).where(eq(assignment.id, fromAssignmentId));
  if (!old || old.orderId !== orderId || !(ACTIVE_ASSIGN_STATUSES as readonly string[]).includes(old.status)) throw new UserError('바꿀 배정을 찾을 수 없습니다.');
  if (old.technicianId === toTechId) throw new UserError('지금 배정된 기사와 같습니다.');
  const role = old.role as AssignRole;
  const others = (await activeAssignments(db, orderId)).filter((a) => a.id !== old.id && a.technicianId);
  const plan = [{ role, technicianId: toTechId }, ...others.map((a) => ({ role: a.role as AssignRole, technicianId: a.technicianId! }))];
  const early = decide(await validatePlan(db, ctx, plan), confirmWarnings);
  if (early) return early;
  await db.transaction(async (tx) => {
    await transitionAssignment(tx, old, 'TRANSFERRED', { action, toTechnicianId: toTechId, reason }, actor);
    await tx.insert(assignment).values({
      orderId,
      technicianId: toTechId,
      role,
      timeSlotId: old.timeSlotId,
      scheduledStart: old.scheduledStart ?? ctx.window.start,
      scheduledEnd: old.scheduledEnd ?? ctx.window.end,
      assignMethod: 'MANUAL',
      status: 'ACCEPTED',
      inZone: await inZoneOf(tx, toTechId, ctx.legalDongCode),
      assignedBy: actor.type === 'ADMIN' ? actor.id : null,
      acceptedAt: new Date(),
      createdBy: actor.id,
      updatedBy: actor.id,
    });
  });
  if (old.technicianId) await notifyStaff('TECH_JOB_CHANGED', { type: 'TECHNICIAN', id: old.technicianId }, orderId);
  await notifyStaff('TECH_JOB_ASSIGNED', { type: 'TECHNICIAN', id: toTechId }, orderId, jobLink(ctx.order.orderNo));
  if (role === 'MAIN') await notifyOrder('TECH_ASSIGNED', orderId, { 기사명: await techDisplayName(toTechId) });
  return { saved: true };
}

/** 운영자 재배정: 주기사 변경 (사유 필수) */
export async function reassignOrder(input: { orderId: number; toTechId: number; reason: string; confirmWarnings: boolean }, filter: BranchFilter, actor: Actor) {
  const main = (await activeAssignments(getDb(), input.orderId)).find((a) => a.role === 'MAIN');
  if (!main) throw new UserError('주기사 배정이 없는 주문입니다. 배정 보드에서 배정하세요.');
  return replaceTech(input.orderId, main.id, input.toTechId, 'REASSIGN', input.reason, input.confirmWarnings, filter, actor);
}

/** 기사 이관 요청 승인(새 기사로 이관) / 반려(원래 기사 유지) */
export async function decideTransfer(
  input: { assignmentId: number; decision: 'APPROVE' | 'REJECT'; toTechId: number | null; reason: string | null; confirmWarnings: boolean },
  filter: BranchFilter,
  actor: Actor,
): Promise<AssignOutcome> {
  const db = getDb();
  const [a] = await db
    .select({ a: assignment, branchId: serviceOrder.branchId })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .where(eq(assignment.id, input.assignmentId));
  if (!a || a.a.status !== 'TRANSFER_REQUESTED') throw new UserError('이미 처리된 이관 요청입니다.');
  assertOrderInScope({ branchId: a.branchId }, filter);
  if (input.decision === 'APPROVE') {
    if (!input.toTechId) throw new UserError(MSG.required('이관받을 기사'));
    return replaceTech(a.a.orderId, a.a.id, input.toTechId, 'TRANSFER', a.a.rejectReason, input.confirmWarnings, filter, actor);
  }
  await db.transaction(async (tx) => {
    await transitionAssignment(tx, a.a, 'ACCEPTED', { action: 'TRANSFER_REJECT', toTechnicianId: a.a.technicianId, reason: input.reason }, actor, { rejectReason: null });
  });
  if (a.a.technicianId) await notifyStaff('TECH_TRANSFER_REJECTED', { type: 'TECHNICIAN', id: a.a.technicianId }, a.a.orderId);
  return { saved: true };
}

/* ---------- F-TEC-JOB-05 기사 이관 요청 ---------- */

export async function requestTransfer(techId: number, orderNo: string, reason: string) {
  const db = getDb();
  const [row] = await db
    .select({ a: assignment, status: serviceOrder.status })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .where(and(eq(serviceOrder.orderNo, orderNo), eq(assignment.technicianId, techId), inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES])));
  if (!row) throw new UserError('내 작업이 아닙니다.');
  if (row.a.status === 'TRANSFER_REQUESTED') throw new UserError('이미 이관을 요청했습니다. 운영자 확인을 기다려 주세요.');
  if (row.status !== 'ASSIGNED') throw new UserError('출발 전(배정완료) 작업만 이관을 요청할 수 있습니다.');
  await db.transaction(async (tx) => {
    await transitionAssignment(tx, row.a, 'TRANSFER_REQUESTED', { action: 'TRANSFER_REQUEST', toTechnicianId: null, reason }, { type: 'TECHNICIAN', id: techId }, { rejectReason: reason });
  });
}

/* ---------- A-DSP-010 배정 보드 데이터 ---------- */

export const BOARD_HOURS = Array.from({ length: 12 }, (_, i) => 8 + i); // 08~19시

export async function loadBoard(branchId: number, date: string, now = new Date()) {
  const db = getDb();
  const { from, to } = dayRange(date);
  const [orders, techRows, schedules, alertHours, counts] = await Promise.all([
    db
      .select({ o: serviceOrder, name: customer.name, roadAddress: customerAddress.roadAddress, legalDongCode: customerAddress.legalDongCode })
      .from(serviceOrder)
      .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
      .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
      .where(
        and(
          eq(serviceOrder.branchId, branchId),
          isNull(serviceOrder.deletedAt),
          inArray(serviceOrder.status, ['RECEIVED', 'ASSIGN_WAIT', 'ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS', 'PENDING', 'WORK_DONE', 'COMPLETED']),
          gte(serviceOrder.promisedAt, from),
          lt(serviceOrder.promisedAt, to),
        ),
      )
      .orderBy(asc(serviceOrder.promisedAt)),
    db
      .select()
      .from(technician)
      .where(and(eq(technician.branchId, branchId), inArray(technician.status, ['ACTIVE', 'TRAINING']), isNull(technician.deletedAt)))
      .orderBy(asc(technician.name)),
    db
      .select()
      .from(workSchedule)
      .innerJoin(technician, eq(technician.id, workSchedule.technicianId))
      .where(and(eq(technician.branchId, branchId), eq(workSchedule.workDate, date))),
    getSettingNumber(SETTING_KEYS.UNASSIGNED_ALERT_HOURS),
    db
      .select({ status: serviceOrder.status, n: sql<number>`count(*)`.mapWith(Number) })
      .from(serviceOrder)
      .where(and(eq(serviceOrder.branchId, branchId), inArray(serviceOrder.status, ['RECEIVED', 'ASSIGN_WAIT', 'PENDING']), isNull(serviceOrder.deletedAt)))
      .groupBy(serviceOrder.status),
  ]);
  const orderIds = orders.map((r) => r.o.id);
  const techIds = techRows.map((t) => t.id);
  const [assigns, devices, skills, areas, defaultStart, defaultEnd] = await Promise.all([
    orderIds.length
      ? db.select().from(assignment).where(and(inArray(assignment.orderId, orderIds), inArray(assignment.status, [...ACTIVE_ASSIGN_STATUSES])))
      : Promise.resolve([]),
    orderDeviceTypes(db, orderIds),
    techIds.length ? db.select().from(technicianSkill).where(inArray(technicianSkill.technicianId, techIds)) : Promise.resolve([]),
    techIds.length ? db.select().from(technicianArea).where(inArray(technicianArea.technicianId, techIds)) : Promise.resolve([]),
    getSettingString(SETTING_KEYS.WORK_DEFAULT_START),
    getSettingString(SETTING_KEYS.WORK_DEFAULT_END),
  ]);
  const cards = orders.map((r) => {
    const w = orderWindow(r.o);
    const as = assigns.filter((a) => a.orderId === r.o.id);
    return {
      id: r.o.id,
      orderNo: r.o.orderNo,
      status: r.o.status,
      orderType: r.o.orderType,
      start: w?.start.toISOString() ?? null,
      end: w?.end.toISOString() ?? null,
      requiredTechCount: r.o.requiredTechCount,
      customerName: maskName(decrypt(r.name)),
      address: shortAddress(r.roadAddress),
      legalDongCode: r.legalDongCode,
      devices: devices.get(r.o.id) ?? [],
      urgent: isUnassignedUrgent(r.o, now, alertHours),
      /** 단계 4-2: 기사 자가 배정 요청이 승인 대기 중 (A-DSP-020 [자가 배정 요청]에서 처리) */
      selfRequested: as.some((a) => a.status === 'REQUESTED' && a.assignMethod === 'SELF'),
      internalNote: r.o.internalNote,
      customerRequest: r.o.customerRequest,
      assignments: as.map((a) => ({ id: a.id, technicianId: a.technicianId, role: a.role, status: a.status })),
    };
  });
  const techs = techRows.map((t) => {
    const s = schedules.find((x) => x.work_schedule.technicianId === t.id)?.work_schedule ?? null;
    return {
      id: t.id,
      name: t.displayName || t.name,
      grade: t.grade,
      status: t.status,
      accompanyDone: t.accompanyDoneCount,
      accompanyRequired: t.accompanyRequiredCount,
      needsAccompany: needsAccompany(t),
      scheduleType: s?.scheduleType ?? null,
      workHours: s ? workHoursOf(s, defaultStart, defaultEnd) : [],
      skills: skills.filter((k) => k.technicianId === t.id).map((k) => ({ deviceType: k.deviceType, skillLevel: k.skillLevel })),
      areaCount: areas.filter((a) => a.technicianId === t.id).length,
    };
  });
  return {
    cards,
    techs,
    summary: {
      waiting: counts.filter((c) => c.status !== 'PENDING').reduce((n, c) => n + c.n, 0),
      unassigned: counts.find((c) => c.status === 'ASSIGN_WAIT')?.n ?? 0,
      pending: counts.find((c) => c.status === 'PENDING')?.n ?? 0,
      urgent: cards.filter((c) => c.urgent).length,
      selfRequested: cards.filter((c) => c.selfRequested).length,
    },
    alertHours,
  };
}

/** 근무 시간(시) — 슬롯 생성과 같은 규칙(근무 유형·기본 시간·반차) */
const workHoursOf = (s: Parameters<typeof hoursOf>[0], defaultStart: string, defaultEnd: string) => hoursOf(s, { defaultStart, defaultEnd });

/** 거점 선택지 (BR-102 범위) */
export async function boardBranches(filter: BranchFilter) {
  return getDb()
    .select({ id: branch.id, name: branch.name })
    .from(branch)
    .where(and(isNull(branch.deletedAt), filter.kind === 'BRANCH' ? eq(branch.id, filter.branchId) : filter.kind === 'NONE' ? eq(branch.id, -1) : undefined))
    .orderBy(asc(branch.name));
}

/* ---------- A-DSP-020 재배정·이관 ---------- */

export async function listTransferRequests(filter: BranchFilter) {
  const rows = await getDb()
    .select({ a: assignment, orderNo: serviceOrder.orderNo, promisedAt: serviceOrder.promisedAt, branchId: serviceOrder.branchId, techName: technician.name, techDisplay: technician.displayName })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .innerJoin(technician, eq(technician.id, assignment.technicianId))
    .where(
      and(
        eq(assignment.status, 'TRANSFER_REQUESTED'),
        filter.kind === 'BRANCH' ? eq(serviceOrder.branchId, filter.branchId) : filter.kind === 'NONE' ? eq(serviceOrder.branchId, -1) : undefined,
      ),
    )
    .orderBy(asc(serviceOrder.promisedAt));
  return rows.map((r) => ({
    assignmentId: r.a.id,
    orderId: r.a.orderId,
    orderNo: r.orderNo,
    promisedAt: r.promisedAt?.toISOString() ?? null,
    branchId: r.branchId,
    role: r.a.role,
    techName: r.techDisplay || r.techName,
    reason: r.a.rejectReason,
    requestedAt: r.a.updatedAt.toISOString(),
  }));
}

/** 접수번호로 재배정 대상 주문 + 현재 배정 */
export async function findOrderForReassign(orderNo: string, filter: BranchFilter) {
  const db = getDb();
  const [o] = await db.select().from(serviceOrder).where(and(eq(serviceOrder.orderNo, orderNo.trim().toUpperCase()), isNull(serviceOrder.deletedAt)));
  if (!o) return null;
  assertOrderInScope(o, filter);
  const as = await db
    .select({ a: assignment, name: technician.name, displayName: technician.displayName })
    .from(assignment)
    .innerJoin(technician, eq(technician.id, assignment.technicianId))
    .where(and(eq(assignment.orderId, o.id), inArray(assignment.status, [...ACTIVE_ASSIGN_STATUSES])));
  return {
    id: o.id,
    orderNo: o.orderNo,
    status: o.status,
    branchId: o.branchId,
    promisedAt: o.promisedAt?.toISOString() ?? null,
    assignments: as.map((r) => ({ id: r.a.id, role: r.a.role, status: r.a.status, technicianId: r.a.technicianId, name: r.displayName || r.name })),
  };
}

/** 거점의 배정 가능 기사 목록(선택지) */
export async function branchTechOptions(branchId: number) {
  const rows = await getDb()
    .select({ id: technician.id, name: technician.name, displayName: technician.displayName, grade: technician.grade, status: technician.status })
    .from(technician)
    .where(and(eq(technician.branchId, branchId), inArray(technician.status, ['ACTIVE', 'TRAINING']), isNull(technician.deletedAt)))
    .orderBy(asc(technician.name));
  return rows.map((t) => ({ id: t.id, name: t.displayName || t.name, grade: t.grade, status: t.status }));
}

/* ---------- F-SYS-09 미지정 건 경고 (15분 배치) ---------- */

/** 약속이 UNASSIGNED_ALERT_HOURS 이내인 미지정(ASSIGN_WAIT) 건마다 운영자 경고 1회 */
export async function alertUnassigned(now = new Date()): Promise<number> {
  const db = getDb();
  const hours = await getSettingNumber(SETTING_KEYS.UNASSIGNED_ALERT_HOURS);
  const rows = await db
    .select({ id: serviceOrder.id, status: serviceOrder.status, promisedAt: serviceOrder.promisedAt })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.status, 'ASSIGN_WAIT'),
        isNull(serviceOrder.deletedAt),
        gte(serviceOrder.promisedAt, new Date(now.getTime() - 24 * 3600_000)),
        lt(serviceOrder.promisedAt, new Date(now.getTime() + hours * 3600_000 + 60_000)),
      ),
    );
  let sent = 0;
  for (const o of rows) {
    if (!isUnassignedUrgent(o, now, hours)) continue;
    if (await alreadyNotified('UNASSIGNED_WARNING', o.id)) continue;
    await notifyStaff('UNASSIGNED_WARNING', { type: 'ADMIN', id: null }, o.id);
    sent++;
  }
  return sent;
}

/** 관리자 화면 상단 경고용: 범위 안 미지정 긴급 건 수 */
export async function countUrgentUnassigned(filter: BranchFilter, now = new Date()) {
  const hours = await getSettingNumber(SETTING_KEYS.UNASSIGNED_ALERT_HOURS);
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.status, 'ASSIGN_WAIT'),
        isNull(serviceOrder.deletedAt),
        lt(serviceOrder.promisedAt, new Date(now.getTime() + hours * 3600_000)),
        filter.kind === 'BRANCH' ? eq(serviceOrder.branchId, filter.branchId) : filter.kind === 'NONE' ? eq(serviceOrder.branchId, -1) : undefined,
      ),
    );
  return r?.n ?? 0;
}
