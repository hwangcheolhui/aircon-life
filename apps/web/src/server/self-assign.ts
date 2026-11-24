import 'server-only';
/**
 * 관할 내 미배정 작업 담기 · 자가 배정 승인 (단계 4-2: F-TEC-RTE-04, F-ADM-DSP-10, BR-110·111).
 * - 기사에게는 내 관할 법정동(technician_area) 안의 배정 전 주문만 보인다(BR-110, isUnassignedVisible).
 * - [내 일정에 넣기] → assignment(assign_method SELF). 승인 필요(설정·보조 관할·2인 작업)면 REQUESTED(승인 대기),
 *   아니면 바로 ACCEPTED + 주문 ASSIGNED + 고객 기사 배정 알림. 이력은 SELF_REQUEST(+SELF_APPROVE).
 * - 동시성: 주문 행을 잠그고(SELECT … FOR UPDATE) 살아 있는 배정이 없을 때만 넣는다. 그래도 겹치면 부분 유니크 인덱스
 *   assignment_active_main_uk 가 막는다 → 늦은 쪽은 "이미 배정된 작업입니다".
 * - 승인/반려(A-DSP-020 자가 배정 요청 탭)는 배정 상태 전이(REQUESTED → ACCEPTED/REJECTED)를 거친다.
 */
import {
  assignment,
  assignmentHistory,
  customer,
  customerAddress,
  orderItem,
  serviceOrder,
  serviceProduct,
  technician,
  technicianArea,
  technicianSkill,
  timeSlot,
} from '@aircon/db';
import {
  type BranchFilter,
  SETTING_KEYS,
  UNASSIGNED_ORDER_STATUSES,
  assertAssignTransition,
  checkSelfAssign,
  isUnassignedVisible,
  kstDate,
  maskName,
  shortAddress,
} from '@aircon/domain';
import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { formatVisit } from '@/customer/format';
import { UserError } from './action-result';
import { ForbiddenError } from './auth';
import { getDb } from './db';
import { orderWindow } from './dispatch';
import { ensureAddressCoords } from './geo';
import { notifyOrder, notifyStaffWith } from './notify';
import { type Actor, isUniqueViolation, transitionOrder } from './orders';
import { decrypt } from './pii';
import { addDays, insertionPreview, syncPlan } from './route-plans';
import { getSettingNumber, getSettingString } from './settings';

const yes = (v: string) => v.trim().toUpperCase() === 'Y';

async function selfAssignSettings() {
  const [enabled, approval, days] = await Promise.all([
    getSettingString(SETTING_KEYS.SELF_ASSIGN_ENABLED),
    getSettingString(SETTING_KEYS.SELF_ASSIGN_NEEDS_APPROVAL),
    getSettingNumber(SETTING_KEYS.SELF_ASSIGN_DAYS_AHEAD),
  ]);
  return { enabled: yes(enabled), needsApproval: yes(approval), days };
}

async function techContext(techId: number) {
  const db = getDb();
  const [[t], areas, skills] = await Promise.all([
    db.select().from(technician).where(eq(technician.id, techId)),
    db.select().from(technicianArea).where(eq(technicianArea.technicianId, techId)),
    db.select().from(technicianSkill).where(eq(technicianSkill.technicianId, techId)),
  ]);
  if (!t) throw new UserError('기사를 찾을 수 없습니다.');
  return { t, areas: areas.map((a) => ({ code: a.legalDongCode, priority: a.priority })), skills };
}

async function deviceTypes(orderIds: number[]) {
  const out = new Map<number, { deviceType: string; name: string; quantity: number }[]>();
  if (!orderIds.length) return out;
  const rows = await getDb()
    .select({ orderId: orderItem.orderId, deviceType: serviceProduct.deviceType, name: serviceProduct.name, quantity: orderItem.quantity })
    .from(orderItem)
    .innerJoin(serviceProduct, eq(serviceProduct.id, orderItem.productId))
    .where(and(inArray(orderItem.orderId, orderIds), eq(orderItem.itemType, 'PRODUCT')));
  for (const r of rows) out.set(r.orderId, [...(out.get(r.orderId) ?? []), { deviceType: r.deviceType, name: r.name, quantity: r.quantity }]);
  return out;
}

/* ---------- T-RTE-020 / T-MAP-010 미배정 핀 ---------- */

export interface UnassignedPin {
  orderNo: string;
  date: string;
  promisedAt: string | null;
  timeTo: string | null;
  customerName: string;
  address: string;
  devices: string;
  deviceTypes: string[];
  point: { lat: number; lng: number } | null;
  requiredTechCount: number;
  primary: boolean;
  canRequest: boolean;
  needsApproval: boolean;
  reasons: string[];
  insertion: { position: number; addedTravelMin: number; arrival: string } | null;
}

/** BR-110 내 관할 안의 배정 전 주문 (date 를 주면 그날만, 삽입 미리보기 포함) */
export async function listUnassignedInZone(techId: number, opts: { date?: string | null; withInsertion?: boolean } = {}, now = new Date()): Promise<UnassignedPin[]> {
  const db = getDb();
  const [{ t, areas, skills }, set] = await Promise.all([techContext(techId), selfAssignSettings()]);
  const codes = areas.map((a) => a.code);
  if (!codes.length) return [];
  const today = kstDate(now);
  const from = new Date(`${opts.date ?? today}T00:00:00+09:00`);
  const to = new Date(`${addDays(opts.date ?? today, opts.date ? 1 : set.days + 1)}T00:00:00+09:00`);
  const rows = await db
    .select({ o: serviceOrder, code: customerAddress.legalDongCode, road: customerAddress.roadAddress, name: customer.name })
    .from(serviceOrder)
    .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
    .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
    .where(
      and(
        eq(serviceOrder.branchId, t.branchId),
        inArray(serviceOrder.status, [...UNASSIGNED_ORDER_STATUSES]),
        isNull(serviceOrder.deletedAt),
        inArray(customerAddress.legalDongCode, codes),
        gte(serviceOrder.promisedAt, from),
        lt(serviceOrder.promisedAt, to),
      ),
    )
    .orderBy(asc(serviceOrder.promisedAt));
  const ids = rows.map((r) => r.o.id);
  const [devs, taken, coords] = await Promise.all([
    deviceTypes(ids),
    ids.length
      ? db
          .select({ orderId: assignment.orderId })
          .from(assignment)
          .where(and(inArray(assignment.orderId, ids), eq(assignment.role, 'MAIN'), inArray(assignment.status, ['REQUESTED', 'PROPOSED', 'ACCEPTED', 'TRANSFER_REQUESTED'])))
      : Promise.resolve([]),
    ensureAddressCoords(rows.map((r) => r.o.addressId)),
  ]);
  const takenIds = new Set(taken.map((x) => x.orderId));
  const out: UnassignedPin[] = [];
  for (const r of rows) {
    if (takenIds.has(r.o.id)) continue; // 다른 기사가 승인 대기 중
    const date = r.o.promisedAt ? kstDate(r.o.promisedAt) : null;
    const d = devs.get(r.o.id) ?? [];
    const order = { status: r.o.status, legalDongCode: r.code, date, deviceTypes: d.map((x) => x.deviceType), requiredTechCount: r.o.requiredTechCount };
    if (!isUnassignedVisible(order, areas, today, set.days)) continue;
    const ins = opts.withInsertion && date ? await insertionPreview(techId, date, r.o) : null;
    const check = checkSelfAssign({
      enabled: set.enabled,
      needsApprovalSetting: set.needsApproval,
      order,
      tech: { status: t.status, grade: t.grade, accompanyDoneCount: t.accompanyDoneCount, accompanyRequiredCount: t.accompanyRequiredCount, skills },
      areas,
      today,
      daysAhead: set.days,
      working: ins ? ins.working : true,
      insertionOk: ins ? ins.ok : true,
    });
    out.push({
      orderNo: r.o.orderNo,
      date: date!,
      promisedAt: r.o.promisedAt?.toISOString() ?? null,
      timeTo: r.o.requestedTimeTo?.slice(0, 5) ?? null,
      customerName: maskName(decrypt(r.name)),
      address: shortAddress(r.road),
      devices: d.map((x) => `${x.name} ${x.quantity}대`).join(', '),
      deviceTypes: d.map((x) => x.deviceType),
      point: coords.get(r.o.addressId) ?? null,
      requiredTechCount: r.o.requiredTechCount,
      primary: areas.some((a) => a.code === r.code && a.priority === 1),
      canRequest: opts.withInsertion ? check.canRequest : false,
      needsApproval: check.needsApproval,
      reasons: opts.withInsertion ? check.reasons : [],
      insertion: ins ? { position: ins.position, addedTravelMin: ins.addedTravelMin, arrival: ins.arrival } : null,
    });
  }
  return out;
}

/* ---------- F-TEC-RTE-04 [내 일정에 넣기] ---------- */

export async function requestSelfAssign(techId: number, orderNo: string, now = new Date()): Promise<{ status: 'REQUESTED' | 'ACCEPTED' }> {
  const db = getDb();
  const [{ t, areas, skills }, set] = await Promise.all([techContext(techId), selfAssignSettings()]);
  const [o] = await db
    .select({ o: serviceOrder, code: customerAddress.legalDongCode })
    .from(serviceOrder)
    .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
    .where(and(eq(serviceOrder.orderNo, orderNo), isNull(serviceOrder.deletedAt)));
  if (!o || o.o.branchId !== t.branchId) throw new UserError('작업을 찾을 수 없습니다.');
  if (!(UNASSIGNED_ORDER_STATUSES as readonly string[]).includes(o.o.status)) throw new UserError('이미 배정된 작업입니다.');
  const date = o.o.promisedAt ? kstDate(o.o.promisedAt) : null;
  const w = orderWindow(o.o);
  if (!date || !w) throw new UserError('약속 일시가 없는 작업은 담을 수 없습니다.');
  const devs = (await deviceTypes([o.o.id])).get(o.o.id) ?? [];
  const ins = await insertionPreview(techId, date, o.o);
  const check = checkSelfAssign({
    enabled: set.enabled,
    needsApprovalSetting: set.needsApproval,
    order: { status: o.o.status, legalDongCode: o.code, date, deviceTypes: devs.map((d) => d.deviceType), requiredTechCount: o.o.requiredTechCount },
    tech: { status: t.status, grade: t.grade, accompanyDoneCount: t.accompanyDoneCount, accompanyRequiredCount: t.accompanyRequiredCount, skills },
    areas,
    today: kstDate(now),
    daysAhead: set.days,
    working: ins?.working ?? false,
    insertionOk: ins?.ok ?? false,
  });
  if (!check.visible) throw new UserError('내 관할 구역의 작업이 아닙니다.');
  if (!check.canRequest) throw new UserError(check.reasons.join('\n'));
  const status = check.needsApproval ? ('REQUESTED' as const) : ('ACCEPTED' as const);
  const actor: Actor = { type: 'TECHNICIAN', id: techId };
  const primary = areas.some((a) => a.code === o.code && a.priority === 1);
  try {
    await db.transaction(async (tx) => {
      // 같은 주문을 동시에 담으면 먼저 잠근 쪽만 진행
      const locked = await tx.execute<{ status: string }>(sql`SELECT status FROM service_order WHERE id = ${o.o.id} FOR UPDATE`);
      const cur = (locked as unknown as { status: string }[])[0];
      if (!cur || !(UNASSIGNED_ORDER_STATUSES as readonly string[]).includes(cur.status)) throw new UserError('이미 배정된 작업입니다.');
      const live = await tx
        .select({ id: assignment.id })
        .from(assignment)
        .where(and(eq(assignment.orderId, o.o.id), inArray(assignment.status, ['REQUESTED', 'PROPOSED', 'ACCEPTED', 'TRANSFER_REQUESTED'])));
      if (live.length) throw new UserError('이미 배정된 작업입니다.');
      const [slot] = o.o.requestedDate && o.o.requestedTimeFrom
        ? await tx
            .select({ id: timeSlot.id })
            .from(timeSlot)
            .where(and(eq(timeSlot.branchId, o.o.branchId), eq(timeSlot.slotDate, o.o.requestedDate), eq(timeSlot.slotHour, Number(o.o.requestedTimeFrom.slice(0, 2))), eq(timeSlot.slotKind, 'NORMAL')))
        : [];
      await tx.insert(assignment).values({
        orderId: o.o.id,
        technicianId: techId,
        role: 'MAIN',
        timeSlotId: slot?.id ?? null,
        scheduledStart: w.start,
        scheduledEnd: w.end,
        assignMethod: 'SELF',
        status,
        inZone: true,
        acceptedAt: status === 'ACCEPTED' ? new Date() : null,
        createdBy: techId,
        updatedBy: techId,
      });
      await tx.insert(assignmentHistory).values({
        orderId: o.o.id,
        fromTechnicianId: null,
        toTechnicianId: techId,
        action: 'SELF_REQUEST',
        reason: primary ? '관할 지도에서 담기(주 관할)' : '관할 지도에서 담기(보조 관할)',
        actorType: 'TECHNICIAN',
        actorId: techId,
      });
      if (status === 'ACCEPTED') {
        await tx.insert(assignmentHistory).values({ orderId: o.o.id, fromTechnicianId: null, toTechnicianId: techId, action: 'SELF_APPROVE', reason: '승인 불필요(거점 설정)', actorType: 'SYSTEM', actorId: null });
        await transitionOrder(tx, o.o, 'ASSIGNED', actor, { memo: '기사 자가 배정' });
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError('이미 배정된 작업입니다.');
    throw e;
  }
  if (status === 'ACCEPTED') {
    await notifyOrder('TECH_ASSIGNED', o.o.id, { 기사명: t.displayName || t.name });
    await syncPlan(techId, date, actor).catch((e) => console.error('코스 반영 실패', e));
  } else {
    await notifyStaffWith('SELF_ASSIGN_REQUESTED', { type: 'ADMIN', id: null }, { type: 'ORDER', id: o.o.id }, {
      기사명: t.displayName || t.name,
      접수번호: o.o.orderNo,
      방문일시: o.o.promisedAt ? formatVisit(o.o.promisedAt) : '',
    });
  }
  return { status };
}

/* ---------- A-DSP-020 자가 배정 요청 탭 · F-ADM-DSP-10 ---------- */

const scopeCond = (filter: BranchFilter) =>
  filter.kind === 'BRANCH' ? eq(serviceOrder.branchId, filter.branchId) : filter.kind === 'NONE' ? eq(serviceOrder.branchId, -1) : undefined;

export async function listSelfAssignRequests(filter: BranchFilter) {
  const rows = await getDb()
    .select({ a: assignment, orderNo: serviceOrder.orderNo, promisedAt: serviceOrder.promisedAt, branchId: serviceOrder.branchId, addressId: serviceOrder.addressId, o: serviceOrder, road: customerAddress.roadAddress, techName: technician.name, techDisplay: technician.displayName })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
    .innerJoin(technician, eq(technician.id, assignment.technicianId))
    .where(and(eq(assignment.status, 'REQUESTED'), eq(assignment.assignMethod, 'SELF'), scopeCond(filter)))
    .orderBy(asc(serviceOrder.promisedAt));
  const out = [];
  for (const r of rows) {
    const date = r.promisedAt ? kstDate(r.promisedAt) : null;
    // 코스 영향: 그 기사 코스에 넣었을 때 위치·이동시간 증가
    const ins = date && r.a.technicianId ? await insertionPreview(r.a.technicianId, date, r.o).catch(() => null) : null;
    const [area] = await getDb()
      .select({ priority: technicianArea.priority })
      .from(technicianArea)
      .innerJoin(customerAddress, eq(customerAddress.legalDongCode, technicianArea.legalDongCode))
      .where(and(eq(technicianArea.technicianId, r.a.technicianId!), eq(customerAddress.id, r.addressId)));
    out.push({
      assignmentId: r.a.id,
      orderNo: r.orderNo,
      promisedAt: r.promisedAt?.toISOString() ?? null,
      branchId: r.branchId,
      address: shortAddress(r.road),
      techName: r.techDisplay || r.techName,
      zone: area?.priority === 1 ? 'PRIMARY' : area?.priority === 2 ? 'SECONDARY' : null,
      requiredTechCount: r.o.requiredTechCount,
      requestedAt: r.a.createdAt.toISOString(),
      insertion: ins ? { position: ins.position, addedTravelMin: ins.addedTravelMin, ok: ins.ok } : null,
    });
  }
  return out;
}

export async function countSelfAssignRequests(filter: BranchFilter) {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .where(and(eq(assignment.status, 'REQUESTED'), eq(assignment.assignMethod, 'SELF'), scopeCond(filter)));
  return r?.n ?? 0;
}

export async function decideSelfAssign(input: { assignmentId: number; decision: 'APPROVE' | 'REJECT'; reason: string | null }, filter: BranchFilter, actor: Actor) {
  const db = getDb();
  const [row] = await db
    .select({ a: assignment, o: serviceOrder })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .where(eq(assignment.id, input.assignmentId));
  if (!row || row.a.status !== 'REQUESTED') throw new UserError('이미 처리된 요청입니다.');
  if (filter.kind === 'NONE' || (filter.kind === 'BRANCH' && filter.branchId !== row.o.branchId)) throw new ForbiddenError('다른 거점의 요청입니다.');
  if (input.decision === 'REJECT' && !input.reason?.trim()) throw new UserError('반려 사유은(는) 필수 입력값입니다.');
  const to = input.decision === 'APPROVE' ? ('ACCEPTED' as const) : ('REJECTED' as const);
  assertAssignTransition(row.a.status, to);
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(assignment)
      .set({
        status: to,
        acceptedAt: to === 'ACCEPTED' ? new Date() : null,
        assignedBy: actor.type === 'ADMIN' ? actor.id : null,
        rejectReason: to === 'REJECTED' ? input.reason : null,
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(and(eq(assignment.id, row.a.id), eq(assignment.status, 'REQUESTED')))
      .returning({ id: assignment.id });
    if (!rows.length) throw new UserError('이미 처리된 요청입니다.');
    await tx.insert(assignmentHistory).values({
      orderId: row.o.id,
      fromTechnicianId: row.a.technicianId,
      toTechnicianId: to === 'ACCEPTED' ? row.a.technicianId : null,
      action: to === 'ACCEPTED' ? 'SELF_APPROVE' : 'SELF_REJECT',
      reason: to === 'ACCEPTED' ? '자가 배정 승인' : `자가 배정 반려: ${input.reason}`,
      actorType: actor.type,
      actorId: actor.id,
    });
    if (to === 'ACCEPTED') await transitionOrder(tx, row.o, 'ASSIGNED', actor, { memo: '자가 배정 승인' });
  });
  const techId = row.a.technicianId!;
  const vars = { 접수번호: row.o.orderNo, 방문일시: row.o.promisedAt ? formatVisit(row.o.promisedAt) : '' };
  if (to === 'ACCEPTED') {
    const [t] = await db.select({ name: technician.name, displayName: technician.displayName }).from(technician).where(eq(technician.id, techId));
    await notifyStaffWith('SELF_ASSIGN_APPROVED', { type: 'TECHNICIAN', id: techId }, { type: 'ORDER', id: row.o.id }, vars, `/tech/jobs/${row.o.orderNo}`);
    await notifyOrder('TECH_ASSIGNED', row.o.id, { 기사명: t ? t.displayName || t.name : '' });
    if (row.o.promisedAt) await syncPlan(techId, kstDate(row.o.promisedAt), actor).catch((e) => console.error('코스 반영 실패', e));
  } else {
    await notifyStaffWith('SELF_ASSIGN_REJECTED', { type: 'TECHNICIAN', id: techId }, { type: 'ORDER', id: row.o.id }, vars);
  }
}
