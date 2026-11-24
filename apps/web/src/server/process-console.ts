import 'server-only';
/**
 * 처리 콘솔·미처리 대기열 (단계 6-2).
 * - A-PRC-010 처리 콘솔 F-ADM-PRC-01: 기사명(동명이인 선택)·접수번호·전화로 조회 → 기사 접수 목록(이관 → 미처리 → 진행 → 처리 순)
 * - A-PRC-020 처리 정보 F-ADM-PRC-02: 기사 대신 처리 저장(기사와 같은 완료 검증 BR-041·043, 작업 전이표를 한 칸씩)·미처리 저장(BR-031)
 * - F-ADM-PRC-06 안전관리·서비스 파일(종류마다 2개) · F-ADM-PRC-07 활동내역
 * - A-PRC-050 미처리 대기열 F-ADM-PRC-05: 사유별 목록·경과 시간·장기 미처리(BR-032), 재약속(PENDING → ASSIGNED, BR-031 운영자 확인)·취소
 * 호출하는 서버 액션·페이지가 먼저 requirePermission/requireScreen 으로 권한을 확인하고, 거점 범위(BR-102)는 여기서 branchCond 로 적용한다.
 */
import {
  activityLog,
  adminUser,
  assignment,
  attachment,
  branch,
  customer,
  customerAddress,
  orderItem,
  orderStatusHistory,
  serviceOrder,
  technician,
  workOrder,
  workPhoto,
  workResult,
} from '@aircon/db';
import {
  ACTIVE_ASSIGN_STATUSES,
  CONFIRMED_ASSIGN_STATUSES,
  CONSOLE_FILE_KINDS,
  PROXY_COMPLETE_STATUSES,
  SETTING_KEYS,
  type BranchFilter,
  type WorkStatus,
  absentStreak,
  assertWorkTransition,
  checkConsoleFile,
  checkProxyCompletion,
  checkReschedule,
  consoleGroupOf,
  finalAmount,
  itemStatusFromResults,
  kstDate,
  maskName,
  maskPhone,
  needsOperatorConfirm,
  orderStatusForWork,
  pendingSince,
  proxyWorkPath,
  resultCodeFromResults,
  sortConsoleRows,
} from '@aircon/domain';
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, or } from 'drizzle-orm';
import { UserError, ValidationFailed } from './action-result';
import { branchCond, cancelOrderByAdmin, moveScheduleInTx } from './admin-orders';
import { saveAttachment } from './attachments';
import { getDb } from './db';
import { orderDeviceTypes, orderWindow, slotIdFor } from './dispatch';
import { notifyOrder, notifyStaff } from './notify';
import { type Actor, type OrderRow, transitionOrder } from './orders';
import { completeIfPaid, paymentsOf } from './payments';
import { longPendingIds } from './pending';
import { decrypt, phoneHash } from './pii';
import { markRouteStop } from './route-plans';
import { getSettingNumber } from './settings';
import { PHOTO_MAX_BYTES, absentStreakOf, applyPending, extrasOf, fileUrl, listActivities, transitionWork, unitsOf, workOf } from './work';

const PROXY_MEMO = '관리자 대리 입력';
const PROXY_PHOTO_WORK: readonly string[] = ['READY', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'];
/** 서버 액션 요청 한도(4MB, next.config) 안 */
export const CONSOLE_FILE_MAX_BYTES = 4 * 1024 * 1024;

/* ---------- 공통 ---------- */

async function orderInScope(orderId: number, filter: BranchFilter): Promise<OrderRow> {
  const [o] = await getDb()
    .select()
    .from(serviceOrder)
    .where(and(eq(serviceOrder.id, orderId), isNull(serviceOrder.deletedAt), branchCond(filter)));
  if (!o) throw new UserError('주문을 찾을 수 없거나 조회 권한이 없습니다.');
  return o;
}

async function confirmedAssignments(orderId: number) {
  return getDb()
    .select({ a: assignment, name: technician.name, displayName: technician.displayName })
    .from(assignment)
    .innerJoin(technician, eq(technician.id, assignment.technicianId))
    .where(and(eq(assignment.orderId, orderId), inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES])));
}

async function mainTechOf(orderId: number) {
  const main = (await confirmedAssignments(orderId)).find((r) => r.a.role === 'MAIN');
  return main?.a.technicianId ?? null;
}

const techLabel = (t: { name: string; displayName: string | null }) => t.displayName || t.name;
/** KST 'YYYY-MM-DDTHH:mm' → Date */
const kstLocal = (s: string) => new Date(`${s}:00+09:00`);

/* ---------- F-ADM-PRC-01 조회 ---------- */

/** 기사명 검색 (동명이인이면 화면에서 골라 선택) */
export async function findTechs(name: string, filter: BranchFilter) {
  const q = name.trim();
  if (!q) return [];
  const rows = await getDb()
    .select({ id: technician.id, name: technician.name, displayName: technician.displayName, phone: technician.phone, status: technician.status, branchName: branch.name })
    .from(technician)
    .innerJoin(branch, eq(branch.id, technician.branchId))
    .where(
      and(
        isNull(technician.deletedAt),
        or(like(technician.name, `%${q}%`), like(technician.displayName, `%${q}%`)),
        filter.kind === 'BRANCH' ? eq(technician.branchId, filter.branchId) : filter.kind === 'NONE' ? eq(technician.branchId, -1) : undefined,
      ),
    )
    .orderBy(asc(technician.name))
    .limit(30);
  return rows.map(({ phone, ...r }) => ({ ...r, phoneMasked: maskPhone(decrypt(phone)) }));
}
export type TechHit = Awaited<ReturnType<typeof findTechs>>[number];

/** 선택된 기사 (거점 범위 안) */
export async function techById(id: number, filter: BranchFilter) {
  const [t] = await getDb()
    .select({ id: technician.id, name: technician.name, displayName: technician.displayName, branchId: technician.branchId })
    .from(technician)
    .where(eq(technician.id, id));
  if (!t || filter.kind === 'NONE' || (filter.kind === 'BRANCH' && filter.branchId !== t.branchId)) return null;
  return { id: t.id, name: techLabel(t) };
}

export interface ConsoleQuery {
  techId: number | null;
  orderNo: string | null;
  phone: string | null;
  from: string;
  to: string;
}

/** 기사 접수 목록: 기사 = 기간 안 약속 + 아직 끝나지 않은 미처리·이관 요청, 접수번호·전화 = 해당 주문 */
export async function consoleOrders(q: ConsoleQuery, filter: BranchFilter) {
  const db = getDb();
  let ids: number[] = [];
  if (q.techId) {
    const fromAt = new Date(`${q.from}T00:00:00+09:00`);
    const toAt = new Date(new Date(`${q.to}T00:00:00+09:00`).getTime() + 24 * 3600_000);
    const rows = await db
      .selectDistinct({ id: serviceOrder.id })
      .from(assignment)
      .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
      .where(
        and(
          eq(assignment.technicianId, q.techId),
          inArray(assignment.status, [...ACTIVE_ASSIGN_STATUSES]),
          isNull(serviceOrder.deletedAt),
          branchCond(filter),
          or(
            and(gte(serviceOrder.promisedAt, fromAt), lt(serviceOrder.promisedAt, toAt)),
            eq(serviceOrder.status, 'PENDING'),
            eq(assignment.status, 'TRANSFER_REQUESTED'),
          ),
        ),
      );
    ids = rows.map((r) => r.id);
  } else if (q.orderNo || q.phone) {
    const digits = (q.phone ?? '').replace(/\D/g, '');
    const rows = await db
      .select({ id: serviceOrder.id })
      .from(serviceOrder)
      .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
      .where(
        and(
          isNull(serviceOrder.deletedAt),
          branchCond(filter),
          q.orderNo ? eq(serviceOrder.orderNo, q.orderNo.trim()) : undefined,
          digits ? eq(customer.phone1Hash, phoneHash(digits)) : undefined,
        ),
      )
      .orderBy(desc(serviceOrder.promisedAt))
      .limit(50);
    ids = rows.map((r) => r.id);
  }
  if (!ids.length) return [];
  const [orders, assigns, works, devices] = await Promise.all([
    db
      .select({ o: serviceOrder, name: customer.name })
      .from(serviceOrder)
      .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
      .where(inArray(serviceOrder.id, ids)),
    db
      .select({ a: assignment, name: technician.name, displayName: technician.displayName })
      .from(assignment)
      .innerJoin(technician, eq(technician.id, assignment.technicianId))
      .where(and(inArray(assignment.orderId, ids), inArray(assignment.status, [...ACTIVE_ASSIGN_STATUSES]))),
    db.select().from(workOrder).where(inArray(workOrder.orderId, ids)),
    orderDeviceTypes(db, ids),
  ]);
  const overdue = await longPendingIds(orders.map((r) => r.o));
  const rows = orders.map(({ o, name }) => {
    const as = assigns.filter((x) => x.a.orderId === o.id);
    const main = as.find((x) => x.a.role === 'MAIN');
    const w = works.find((x) => x.orderId === o.id);
    const transferRequested = as.some((x) => x.a.status === 'TRANSFER_REQUESTED');
    return {
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      promisedAt: o.promisedAt,
      customerName: maskName(decrypt(name)),
      devices: (devices.get(o.id) ?? []).map((d) => `${d.name} ${d.quantity}대`).join(', '),
      pendingReason: o.status === 'PENDING' ? o.pendingReason : null,
      resultCode: w?.resultCode ?? null,
      mainTechName: main ? techLabel(main) : '',
      transferRequested,
      overdue48h: overdue.has(o.id),
      done: consoleGroupOf({ status: o.status, transferRequested }) === 3,
    };
  });
  return sortConsoleRows(rows);
}
export type ConsoleRow = Awaited<ReturnType<typeof consoleOrders>>[number];

/* ---------- A-PRC-020 처리 정보 ---------- */

export async function consoleDetail(orderId: number, filter: BranchFilter) {
  const o = await orderInScope(orderId, filter);
  const db = getDb();
  const [[c], [addr], [b], team, { units }, w, payments, activities, historyRows] = await Promise.all([
    db.select({ name: customer.name, phone: customer.phone1 }).from(customer).where(eq(customer.id, o.customerId)),
    db.select({ road: customerAddress.roadAddress }).from(customerAddress).where(eq(customerAddress.id, o.addressId)),
    db.select({ name: branch.name }).from(branch).where(eq(branch.id, o.branchId)),
    confirmedAssignments(o.id),
    unitsOf(o),
    workOf(db, o.id),
    paymentsOf(o.id),
    listActivities(o.id),
    db
      .select({
        h: orderStatusHistory,
        techName: technician.name,
        adminName: adminUser.name,
      })
      .from(orderStatusHistory)
      .leftJoin(technician, and(eq(orderStatusHistory.actorType, 'TECHNICIAN'), eq(technician.id, orderStatusHistory.actorId)))
      .leftJoin(adminUser, and(eq(orderStatusHistory.actorType, 'ADMIN'), eq(adminUser.id, orderStatusHistory.actorId)))
      .where(eq(orderStatusHistory.orderId, o.id))
      .orderBy(asc(orderStatusHistory.id)),
  ]);
  const [results, photos, files, extras] = w
    ? await Promise.all([
        db.select().from(workResult).where(eq(workResult.workOrderId, w.id)),
        db.select().from(workPhoto).where(eq(workPhoto.workOrderId, w.id)).orderBy(asc(workPhoto.id)),
        db
          .select()
          .from(attachment)
          .where(and(inArray(attachment.refType, [...CONSOLE_FILE_KINDS]), eq(attachment.refId, w.id), isNull(attachment.deletedAt)))
          .orderBy(asc(attachment.id)),
        extrasOf(w.id),
      ])
    : [[], [], [], { agreed: 0, pending: 0 }];
  const history = historyRows.map((r) => ({
    id: r.h.id,
    fromStatus: r.h.fromStatus,
    toStatus: r.h.toStatus,
    reasonCode: r.h.reasonCode,
    memo: r.h.memo,
    actorType: r.h.actorType,
    actorName: r.techName ?? r.adminName ?? '',
    createdAt: r.h.createdAt,
  }));
  const main = team.find((t) => t.a.role === 'MAIN');
  const streak = absentStreak(history);
  return {
    order: {
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      promisedAt: o.promisedAt,
      branchName: b?.name ?? '',
      customerName: maskName(decrypt(c?.name ?? null)),
      customerPhone: maskPhone(decrypt(c?.phone ?? null)),
      address: addr?.road ?? '',
      customerRequest: o.customerRequest,
      internalNote: o.internalNote,
      pendingReason: o.pendingReason,
      totalAmount: o.totalAmount,
      paidAmount: o.paidAmount,
      paymentStatus: o.paymentStatus,
    },
    mainTech: main ? { id: main.a.technicianId, name: techLabel(main) } : null,
    supportTechs: team.filter((t) => t.a.role !== 'MAIN').map((t) => ({ role: t.a.role, name: techLabel(t) })),
    work: w
      ? {
          status: w.status,
          departedAt: w.departedAt,
          arrivedAt: w.arrivedAt,
          finishedAt: w.finishedAt,
          workMinutes: w.workMinutes,
          resultCode: w.resultCode,
          pendingCode: w.pendingCode,
          safetyChecklistDone: w.safetyChecklistDone,
          highPlaceWork: w.highPlaceWork,
          workNote: w.workNote,
          internalNote: w.internalNote,
          laborAmount: w.laborAmount,
          extraAmount: w.extraAmount,
          materialAmount: w.materialAmount,
          discountAmount: w.discountAmount,
          finalAmount: w.finalAmount,
          receivedAmount: w.receivedAmount,
        }
      : null,
    units,
    results: results.map((r) => ({ orderItemId: r.orderItemId, unitNo: r.unitNo, result: r.result })),
    photos: photos.map((p) => ({ id: p.id, photoType: p.photoType, orderItemId: p.orderItemId, unitNo: p.unitNo, url: fileUrl(p.fileId) })),
    files: files.map((f) => ({ id: f.id, kind: f.refType, name: f.originalName, url: fileUrl(f.id) })),
    extras,
    activities,
    history,
    payments,
    absentStreak: streak,
    operatorConfirm: o.status === 'PENDING' && needsOperatorConfirm(streak),
    canComplete: (PROXY_COMPLETE_STATUSES as readonly string[]).includes(o.status) && Boolean(main),
  };
}
export type ConsoleDetail = Awaited<ReturnType<typeof consoleDetail>>;

/* ---------- F-ADM-PRC-02 대리 처리 저장 ---------- */

export type ProxyCompleteResult = { done: true } | { done: false; problems: string[] };

export async function proxyComplete(
  v: {
    orderId: number;
    visitedAt: string;
    workMinutes: number;
    safetyDone: boolean;
    highPlaceWork: boolean;
    materialAmount: number;
    discountAmount: number;
    workNote: string;
    internalNote: string | null;
    units: { orderItemId: number; unitNo: number; result: string }[];
  },
  filter: BranchFilter,
  actor: Actor,
  reportUrl: (orderNo: string) => string,
  now = new Date(),
): Promise<ProxyCompleteResult> {
  const o = await orderInScope(v.orderId, filter);
  const mainTechId = await mainTechOf(o.id);
  if (!mainTechId) throw new UserError('주기사 배정이 없습니다. 배정 보드에서 기사를 먼저 정해 주세요.');
  const db = getDb();
  const { units } = await unitsOf(o);
  const known = new Set(units.map((u) => `${u.orderItemId}:${u.unitNo}`));
  for (const u of v.units) if (!known.has(`${u.orderItemId}:${u.unitNo}`)) throw new UserError('그사이 주문 기기가 바뀌었습니다. 새로고침 후 다시 입력해 주세요.');
  const w0 = await workOf(db, o.id);
  const photos = w0 ? await db.select().from(workPhoto).where(eq(workPhoto.workOrderId, w0.id)) : [];
  const extras = await extrasOf(w0?.id ?? null);
  const visitedAt = kstLocal(v.visitedAt);
  const check = checkProxyCompletion({
    orderStatus: o.status,
    units,
    results: v.units,
    photos,
    safetyDone: v.safetyDone,
    pendingExtraCharges: extras.pending,
    workNote: v.workNote,
    noteMinLength: await getSettingNumber(SETTING_KEYS.WORK_NOTE_MIN_LENGTH),
    visitedAt: Number.isNaN(visitedAt.getTime()) ? null : visitedAt,
    now,
    workMinutes: v.workMinutes,
    materialAmount: v.materialAmount,
    discountAmount: v.discountAmount,
  });
  if (Object.keys(check.fieldErrors).length) throw new ValidationFailed(check.fieldErrors);
  if (!check.ok) return { done: false, problems: check.problems };
  if (w0 && !proxyWorkPath(w0.status as WorkStatus).length) throw new UserError('지금 작업 상태에서는 처리 저장을 할 수 없습니다.');
  const finishedAt = new Date(visitedAt.getTime() + v.workMinutes * 60_000);
  const final = finalAmount({ laborAmount: o.totalAmount, agreedExtra: extras.agreed, materialAmount: v.materialAmount, discountAmount: v.discountAmount });
  const results = v.units.map((u) => u.result);
  await db.transaction(async (tx) => {
    let w = w0;
    if (!w) {
      assertWorkTransition(null, 'READY');
      const [created] = await tx
        .insert(workOrder)
        .values({ orderId: o.id, mainTechnicianId: mainTechId, status: 'READY', createdBy: actor.id, updatedBy: actor.id })
        .returning();
      w = created!;
    }
    for (const u of v.units) {
      await tx
        .insert(workResult)
        .values({ workOrderId: w.id, ...u, createdBy: actor.id, updatedBy: actor.id })
        .onConflictDoUpdate({
          target: [workResult.workOrderId, workResult.orderItemId, workResult.unitNo],
          set: { result: u.result, updatedAt: now, updatedBy: actor.id },
        });
    }
    for (const it of new Set(units.map((u) => u.orderItemId))) {
      const status = itemStatusFromResults(v.units.filter((r) => r.orderItemId === it).map((r) => r.result));
      await tx.update(orderItem).set({ itemStatus: status, skipReason: status === 'SKIPPED' ? '현장 작업 불가' : null }).where(eq(orderItem.id, it));
    }
    // 01 §3.2 전이표를 한 칸씩: 출발 → 도착 → 작업 시작 → 완료. 주문 상태 이력마다 "관리자 대리 입력"
    let cw: { id: number; status: string } = w;
    let co: { id: number; status: string } = { id: o.id, status: o.status };
    for (const step of proxyWorkPath(w.status as WorkStatus)) {
      const set: Partial<typeof workOrder.$inferInsert> =
        step === 'ON_THE_WAY'
          ? { departedAt: w.departedAt ?? visitedAt }
          : step === 'ARRIVED'
            ? { arrivedAt: w.arrivedAt ?? visitedAt }
            : step === 'IN_PROGRESS'
              ? { startedAt: w.startedAt ?? visitedAt, safetyChecklistDone: true, highPlaceWork: v.highPlaceWork }
              : {
                  safetyChecklistDone: true,
                  highPlaceWork: v.highPlaceWork,
                  finishedAt,
                  workMinutes: v.workMinutes,
                  resultCode: resultCodeFromResults(results, w.repairGuided),
                  workNote: v.workNote,
                  internalNote: v.internalNote,
                  laborAmount: o.totalAmount,
                  extraAmount: extras.agreed,
                  materialAmount: v.materialAmount,
                  discountAmount: v.discountAmount,
                  finalAmount: final,
                };
      const orderSet = step === 'DONE' ? { completedAt: finishedAt, extraAmount: extras.agreed, totalAmount: final } : {};
      await transitionWork(tx, cw, co, step, actor, set, orderSet, PROXY_MEMO);
      cw = { id: cw.id, status: step };
      const os = orderStatusForWork(step);
      if (os && os !== co.status) co = { id: co.id, status: os };
    }
    await markRouteStop(tx, mainTechId, o.id, kstDate(visitedAt), { type: 'DONE' }, finishedAt);
    // 선결제로 이미 다 냈으면 바로 완료 (01 §3.1, BR-081)
    await completeIfPaid(tx, { id: o.id, status: 'WORK_DONE', totalAmount: final, paidAmount: o.paidAmount, paymentStatus: o.paymentStatus });
  });
  await notifyOrder('WORK_DONE', o.id, { 리포트링크: reportUrl(o.orderNo) });
  return { done: true };
}

/** F-ADM-PRC-02 대리 미처리 저장 (기사 미처리 저장과 같은 처리, 이력 메모에 "관리자 대리 입력") */
export async function proxyPending(
  v: { orderId: number; pendingCode: string; memo: string | null; revisitDate: string | null },
  filter: BranchFilter,
  actor: Actor,
) {
  const o = await orderInScope(v.orderId, filter);
  const mainTechId = await mainTechOf(o.id);
  if (!mainTechId) throw new UserError('주기사 배정이 없습니다. 배정 보드에서 기사를 먼저 정해 주세요.');
  return applyPending(o, mainTechId, v, actor);
}

/** 대리 입력 작업 사진 (BR-041 전·후). 작업 건이 없으면 출발 전(READY)으로 만든다 */
export async function proxyAddPhoto(
  v: { orderId: number; orderItemId: number; unitNo: number; photoType: string },
  file: File,
  filter: BranchFilter,
  actor: Actor,
) {
  const o = await orderInScope(v.orderId, filter);
  if (!(PROXY_COMPLETE_STATUSES as readonly string[]).includes(o.status)) throw new UserError('처리 저장 전 주문에만 사진을 올릴 수 있습니다.');
  const mainTechId = await mainTechOf(o.id);
  if (!mainTechId) throw new UserError('주기사 배정이 없습니다.');
  if (!file.type.startsWith('image/')) throw new UserError('사진 파일만 올릴 수 있습니다.');
  if (file.size > PHOTO_MAX_BYTES) throw new UserError('사진이 너무 큽니다(4MB 이하).');
  const { units } = await unitsOf(o);
  if (!units.some((u) => u.orderItemId === v.orderItemId && u.unitNo === v.unitNo)) throw new UserError('어느 기기의 사진인지 골라 주세요.');
  const db = getDb();
  await db.transaction(async (tx) => {
    let w = await workOf(tx, o.id);
    if (!w) {
      assertWorkTransition(null, 'READY');
      const [created] = await tx
        .insert(workOrder)
        .values({ orderId: o.id, mainTechnicianId: mainTechId, status: 'READY', createdBy: actor.id, updatedBy: actor.id })
        .returning();
      w = created!;
    }
    if (!PROXY_PHOTO_WORK.includes(w.status)) throw new UserError('작업이 끝난 뒤에는 사진을 올릴 수 없습니다.');
    const a = await saveAttachment(file, 'WORK_PHOTO', w.id, { type: 'ADMIN', id: actor.id ?? 0 }, tx);
    await tx.insert(workPhoto).values({
      workOrderId: w.id,
      orderItemId: v.orderItemId,
      unitNo: v.unitNo,
      photoType: v.photoType,
      fileId: a.id,
      createdBy: actor.id,
      updatedBy: actor.id,
    });
  });
}

export async function proxyDeletePhoto(photoId: number, filter: BranchFilter, actor: Actor) {
  const db = getDb();
  const [r] = await db
    .select({ p: workPhoto, w: workOrder, branchId: serviceOrder.branchId })
    .from(workPhoto)
    .innerJoin(workOrder, eq(workOrder.id, workPhoto.workOrderId))
    .innerJoin(serviceOrder, eq(serviceOrder.id, workOrder.orderId))
    .where(and(eq(workPhoto.id, photoId), branchCond(filter)));
  if (!r) throw new UserError('사진을 찾을 수 없습니다.');
  if (!PROXY_PHOTO_WORK.includes(r.w.status)) throw new UserError('작업이 끝난 뒤에는 사진을 지울 수 없습니다.');
  await db.transaction(async (tx) => {
    await tx.delete(workPhoto).where(eq(workPhoto.id, r.p.id));
    await tx.update(attachment).set({ deletedAt: new Date() }).where(eq(attachment.id, r.p.fileId));
  });
  void actor;
}

/* ---------- F-ADM-PRC-06 파일 첨부 ---------- */

export async function addConsoleFile(v: { orderId: number; kind: string }, file: File, filter: BranchFilter, actor: Actor) {
  const o = await orderInScope(v.orderId, filter);
  const db = getDb();
  let w = await workOf(db, o.id);
  if (!w) {
    const mainTechId = await mainTechOf(o.id);
    if (!mainTechId) throw new UserError('배정된 기사가 없는 주문에는 파일을 올릴 수 없습니다.');
    assertWorkTransition(null, 'READY');
    const [created] = await db
      .insert(workOrder)
      .values({ orderId: o.id, mainTechnicianId: mainTechId, status: 'READY', createdBy: actor.id, updatedBy: actor.id })
      .returning();
    w = created!;
  }
  const existing = await db
    .select({ id: attachment.id })
    .from(attachment)
    .where(and(eq(attachment.refType, v.kind), eq(attachment.refId, w.id), isNull(attachment.deletedAt)));
  const err = checkConsoleFile({ kind: v.kind, existing: existing.length, size: file.size, maxBytes: CONSOLE_FILE_MAX_BYTES });
  if (err) throw new UserError(err);
  await saveAttachment(file, v.kind, w.id, { type: 'ADMIN', id: actor.id ?? 0 });
}

export async function deleteConsoleFile(fileId: number, filter: BranchFilter) {
  const db = getDb();
  const [r] = await db
    .select({ id: attachment.id })
    .from(attachment)
    .innerJoin(workOrder, eq(workOrder.id, attachment.refId))
    .innerJoin(serviceOrder, eq(serviceOrder.id, workOrder.orderId))
    .where(and(eq(attachment.id, fileId), inArray(attachment.refType, [...CONSOLE_FILE_KINDS]), isNull(attachment.deletedAt), branchCond(filter)));
  if (!r) throw new UserError('파일을 찾을 수 없습니다.');
  await db.update(attachment).set({ deletedAt: new Date() }).where(eq(attachment.id, r.id));
}

/** 관리자 파일 열람: 작업 사진·서명·안전관리·서비스 파일, 거점 범위(BR-102) 안의 주문 */
export async function adminCanViewWorkFile(a: { refType: string; refId: number | null }, filter: BranchFilter) {
  if (!['WORK_PHOTO', 'SIGNATURE', ...CONSOLE_FILE_KINDS].includes(a.refType) || a.refId === null || filter.kind === 'NONE') return false;
  const [r] = await getDb()
    .select({ branchId: serviceOrder.branchId })
    .from(workOrder)
    .innerJoin(serviceOrder, eq(serviceOrder.id, workOrder.orderId))
    .where(eq(workOrder.id, a.refId));
  return Boolean(r && (filter.kind === 'ALL' || filter.branchId === r.branchId));
}

/* ---------- F-ADM-PRC-07 활동내역 ---------- */

export async function adminAddActivity(v: { orderId: number; activityType: string; content: string }, filter: BranchFilter, actor: Actor) {
  const o = await orderInScope(v.orderId, filter);
  await getDb().insert(activityLog).values({ orderId: o.id, actorType: 'ADMIN', actorId: actor.id, activityType: v.activityType, content: v.content });
}

/* ---------- A-PRC-050 미처리 대기열 (F-ADM-PRC-05) ---------- */

export async function pendingQueue(filter: BranchFilter, reason: string | null, now = new Date()) {
  const db = getDb();
  const orders = await db
    .select({ o: serviceOrder, name: customer.name, branchName: branch.name })
    .from(serviceOrder)
    .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
    .innerJoin(branch, eq(branch.id, serviceOrder.branchId))
    .where(and(eq(serviceOrder.status, 'PENDING'), isNull(serviceOrder.deletedAt), branchCond(filter)))
    .orderBy(asc(serviceOrder.updatedAt))
    .limit(500);
  const ids = orders.map((r) => r.o.id);
  if (!ids.length) return { rows: [], counts: {} as Record<string, number> };
  const [history, assigns, overdue] = await Promise.all([
    db.select().from(orderStatusHistory).where(inArray(orderStatusHistory.orderId, ids)).orderBy(asc(orderStatusHistory.id)),
    db
      .select({ orderId: assignment.orderId, role: assignment.role, name: technician.name, displayName: technician.displayName })
      .from(assignment)
      .innerJoin(technician, eq(technician.id, assignment.technicianId))
      .where(and(inArray(assignment.orderId, ids), inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES]))),
    longPendingIds(orders.map((r) => r.o), now),
  ]);
  const all = orders.map(({ o, name, branchName }) => {
    const h = history.filter((x) => x.orderId === o.id);
    const since = pendingSince(h);
    const last = [...h].reverse().find((x) => x.toStatus === 'PENDING');
    const streak = absentStreak(h);
    const main = assigns.find((a) => a.orderId === o.id && a.role === 'MAIN');
    return {
      orderId: o.id,
      orderNo: o.orderNo,
      branchName,
      customerName: maskName(decrypt(name)),
      promisedAt: o.promisedAt,
      pendingReason: o.pendingReason,
      memo: last?.memo ?? null,
      since,
      hours: since ? Math.floor((now.getTime() - since.getTime()) / 3600_000) : 0,
      overdue48h: overdue.has(o.id),
      absentStreak: streak,
      operatorConfirm: needsOperatorConfirm(streak),
      mainTechName: main ? techLabel(main) : '',
      hasMainTech: Boolean(main),
      requestedTimeFrom: o.requestedTimeFrom,
    };
  });
  const counts: Record<string, number> = {};
  for (const r of all) if (r.pendingReason) counts[r.pendingReason] = (counts[r.pendingReason] ?? 0) + 1;
  const rows = (reason ? all.filter((r) => r.pendingReason === reason) : all).sort(
    (a, b) => Number(b.overdue48h) - Number(a.overdue48h) || (a.since?.getTime() ?? 0) - (b.since?.getTime() ?? 0),
  );
  return { rows, counts };
}
export type PendingRow = Awaited<ReturnType<typeof pendingQueue>>['rows'][number];

/**
 * F-ADM-PRC-05 재약속: 미처리(PENDING) → 배정완료(ASSIGNED, 01 §3.1). 같은 기사 배정을 새 일정으로 옮겨 배정 보드의 그날 타임라인에 다시 올린다.
 * 슬롯 반환·차감(BR-021), 작업 건 PENDING → READY(01 §3.2), BR-031 고객부재 2회 연속이면 운영자 확인 내용을 이력에 남긴다.
 */
export async function reschedulePending(
  v: { orderId: number; slotDate: string; slotHour: number; operatorConfirmed: boolean; confirmMemo: string | null },
  filter: BranchFilter,
  actor: Actor,
  now = new Date(),
) {
  const o = await orderInScope(v.orderId, filter);
  const team = await confirmedAssignments(o.id);
  const main = team.find((t) => t.a.role === 'MAIN');
  const streak = await absentStreakOf(o.id);
  const errors = checkReschedule({
    orderStatus: o.status,
    absentStreak: streak,
    operatorConfirmed: v.operatorConfirmed,
    confirmMemo: v.confirmMemo ?? '',
    slotDate: v.slotDate,
    slotHour: v.slotHour,
    today: kstDate(now),
    hasMainTech: Boolean(main),
  });
  if (errors.form) throw new UserError(errors.form);
  if (Object.keys(errors).length) throw new ValidationFailed(errors);
  const hh = String(v.slotHour).padStart(2, '0');
  const memo = [
    `재약속 ${v.slotDate} ${hh}:00`,
    v.confirmMemo ? (needsOperatorConfirm(streak) ? `운영자 확인: ${v.confirmMemo}` : v.confirmMemo) : null,
  ]
    .filter(Boolean)
    .join(' / ')
    .slice(0, 500);
  const db = getDb();
  await db.transaction(async (tx) => {
    await moveScheduleInTx(tx, o, v.slotDate, v.slotHour, actor);
    const [fresh] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, o.id));
    const win = orderWindow(fresh!);
    const slotId = await slotIdFor(tx, fresh!);
    await tx
      .update(assignment)
      .set({ scheduledStart: win?.start ?? null, scheduledEnd: win?.end ?? null, timeSlotId: slotId, updatedAt: now, updatedBy: actor.id })
      .where(inArray(assignment.id, team.map((t) => t.a.id)));
    const w = await workOf(tx, o.id);
    if (w && w.status === 'PENDING') {
      await transitionWork(tx, w, o, 'READY', actor, {
        pendingCode: null,
        departedAt: null,
        arrivedAt: null,
        startedAt: null,
        finishedAt: null,
        safetyChecklistDone: false,
      });
    }
    await transitionOrder(tx, o, 'ASSIGNED', actor, { memo, set: { pendingReason: null } });
  });
  await notifyOrder('ORDER_CHANGED', o.id);
  for (const t of team)
    if (t.a.technicianId) await notifyStaff('TECH_JOB_CHANGED', { type: 'TECHNICIAN', id: t.a.technicianId }, o.id, `/tech/jobs/${o.orderNo}`);
}

/** F-ADM-PRC-05 미처리 취소: 미처리 주문만, 결제 금액 전액 환불·슬롯 반환(관리자 취소 F-ADM-ORD-04와 같은 처리) */
export async function cancelPending(v: { orderId: number; reasonCode: string; memo: string | null }, filter: BranchFilter, actor: Actor) {
  const o = await orderInScope(v.orderId, filter);
  if (o.status !== 'PENDING') throw new UserError('미처리 상태의 주문만 여기서 취소할 수 있습니다.');
  const r = await cancelOrderByAdmin(o.id, v.reasonCode, v.memo, filter, actor);
  // 작업 건도 미처리 → 취소 (01 §3.2). 주문은 이미 취소되어 주문 상태는 더 바꾸지 않는다
  const w = await workOf(getDb(), o.id);
  if (w && w.status === 'PENDING') {
    assertWorkTransition(w.status, 'CANCELED');
    await getDb()
      .update(workOrder)
      .set({ status: 'CANCELED', updatedAt: new Date(), updatedBy: actor.id })
      .where(and(eq(workOrder.id, w.id), eq(workOrder.status, 'PENDING')));
  }
  return r;
}
