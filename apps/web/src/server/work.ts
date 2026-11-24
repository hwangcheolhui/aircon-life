import 'server-only';
/**
 * 현장작업 (단계 5-1: F-TEC-WRK-01~04·07·09·10, F-SYS-04, F-CUS-ORD-05).
 * - 작업 건(work_order)은 주문 1건당 1개, 출발할 때 만든다. 작업 상태 변경은 assertWorkTransition(01 §3.2)을 거치고,
 *   주문 상태는 orderStatusForWork → transitionOrder(전이표 + order_status_history 1행)로 같이 바꾼다.
 * - 출발·도착·완료 처리는 주기사만, 활동내역은 확정 배정된 기사 누구나. 작업은 자기에게 확정된 배정(ACCEPTED·TRANSFER_REQUESTED)만.
 * - 완료 필수 검증은 packages/domain checkCompletion(BR-041·043, F-TEC-WRK-07). 동의 안 된 추가요금은 금액에 넣지 않는다(BR-040, 추가요금은 단계 5-2).
 * - 사진·서명 파일은 저장소 어댑터(STORAGE_DRIVER)에 두고 /api/files/{id} 로 권한을 확인해 내려준다.
 */
import { activityLog, assignment, attachment, orderItem, serviceOrder, technician, workOrder, workPhoto, workResult } from '@aircon/db';
import {
  ACTIVE_WORK_STATUSES,
  CONFIRMED_ASSIGN_STATUSES,
  SETTING_KEYS,
  type WorkStatus,
  assertWorkTransition,
  canSeeWorkReport,
  checkCompletion,
  checkDeparture,
  checkSafety,
  finalAmount,
  itemStatusFromResults,
  kstDate,
  orderStatusForWork,
  resultCodeFromResults,
  workMinutes,
  workUnits,
} from '@aircon/domain';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { formatClock } from '@/customer/format';
import { UserError } from './action-result';
import { saveAttachment } from './attachments';
import { getDb } from './db';
import { notifyOrder } from './notify';
import { type Actor, type OrderRow, type Tx, itemNames, transitionOrder } from './orders';
import { departureEta, markRouteStop, nextRouteOrderNo } from './route-plans';
import { getSettingNumber, getSettingString } from './settings';
import { myLatestLocation } from './tech-duty';
import { myAssignment } from './tech-jobs';

type WorkRow = typeof workOrder.$inferSelect;

export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const fileUrl = (id: number) => `/api/files/${id}`;

/* ---------- 공통 ---------- */

async function mine(techId: number, orderNo: string) {
  const m = await myAssignment(techId, orderNo);
  if (!m) throw new UserError('내 작업이 아닙니다.');
  return m;
}

async function mainOnly(techId: number, orderNo: string) {
  const m = await mine(techId, orderNo);
  if (m.a.role !== 'MAIN') throw new UserError('출발·완료 처리는 주기사만 할 수 있습니다.');
  return m;
}

async function workOf(db: ReturnType<typeof getDb> | Tx, orderId: number): Promise<WorkRow | null> {
  const [w] = await db.select().from(workOrder).where(eq(workOrder.orderId, orderId));
  return w ?? null;
}

/** 작업 상태 변경의 유일한 경로: 작업 전이 검사 → 조건부 UPDATE → 주문 상태 동기화(이력 1행) */
async function transitionWork(
  tx: Tx,
  w: Pick<WorkRow, 'id' | 'status'>,
  o: Pick<OrderRow, 'id' | 'status'>,
  to: WorkStatus,
  actor: Actor,
  set: Partial<typeof workOrder.$inferInsert> = {},
  orderSet: Partial<typeof serviceOrder.$inferInsert> = {},
) {
  assertWorkTransition(w.status, to);
  const rows = await tx
    .update(workOrder)
    .set({ ...set, status: to, updatedAt: new Date(), updatedBy: actor.id })
    .where(and(eq(workOrder.id, w.id), eq(workOrder.status, w.status)))
    .returning({ id: workOrder.id });
  if (!rows.length) throw new UserError('다른 곳에서 먼저 처리된 작업입니다. 새로고침 후 다시 확인해 주세요.');
  const os = orderStatusForWork(to);
  if (os && os !== o.status) await transitionOrder(tx, o, os, actor, { set: orderSet });
}

/** 현장에 가는 인원 = 확정 배정 수 (주기사·지원·동행) — BR-043 고소작업 2인 권장 */
async function teamSizeOf(orderId: number) {
  const rows = await getDb()
    .select({ id: assignment.id })
    .from(assignment)
    .where(and(eq(assignment.orderId, orderId), inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES])));
  return rows.length;
}

/** 기기 단위 (주문 상품 항목 × 수량), 표시명은 견적 스냅샷 이름(BR-014) */
async function unitsOf(o: Pick<OrderRow, 'id' | 'quoteId'>) {
  const db = getDb();
  const items = await db.select().from(orderItem).where(eq(orderItem.orderId, o.id)).orderBy(asc(orderItem.id));
  const names = await itemNames(o.quoteId);
  return { items, units: workUnits(items.map((i) => ({ ...i, name: names(i) }))) };
}

/* ---------- 화면 데이터 (T-WRK-010~060) ---------- */

export async function getWorkState(techId: number, orderNo: string) {
  const m = await myAssignment(techId, orderNo);
  if (!m) return null;
  const db = getDb();
  const o = m.o;
  const [w, teamSize, { units }] = await Promise.all([workOf(db, o.id), teamSizeOf(o.id), unitsOf(o)]);
  const [results, photos] = w
    ? await Promise.all([
        db.select().from(workResult).where(eq(workResult.workOrderId, w.id)),
        db.select().from(workPhoto).where(eq(workPhoto.workOrderId, w.id)).orderBy(asc(workPhoto.id)),
      ])
    : [[], []];
  return {
    orderId: o.id,
    orderNo: o.orderNo,
    orderStatus: o.status,
    role: m.a.role,
    promisedAt: o.promisedAt,
    requiredTechCount: o.requiredTechCount,
    teamSize,
    totalAmount: o.totalAmount,
    work: w,
    units,
    results: results.map((r) => ({
      orderItemId: r.orderItemId,
      unitNo: r.unitNo,
      result: r.result,
      conditionNote: r.conditionNote,
      recommendNext: r.recommendNext,
    })),
    photos: photos.map((p) => ({
      id: p.id,
      photoType: p.photoType,
      orderItemId: p.orderItemId,
      unitNo: p.unitNo,
      url: fileUrl(p.fileId),
    })),
  };
}
export type WorkState = NonNullable<Awaited<ReturnType<typeof getWorkState>>>;

/** 완료 화면의 필수값 체크 결과 (서버 저장과 같은 검증) */
export async function completionCheck(s: WorkState, workNote: string | null) {
  return checkCompletion({
    workStatus: s.work?.status ?? 'READY',
    units: s.units,
    results: s.results,
    photos: s.photos,
    safetyDone: Boolean(s.work?.safetyChecklistDone),
    pendingExtraCharges: 0,
    workNote,
    noteMinLength: await getSettingNumber(SETTING_KEYS.WORK_NOTE_MIN_LENGTH),
  });
}

export const cameraOnly = async () => (await getSettingString(SETTING_KEYS.WORK_PHOTO_CAMERA_ONLY)) === 'Y';

/** 기사 앱 "진행 중 작업" 고정 배너 (출발~작업중, 한 기사에 1건) */
export async function activeWorkOf(techId: number) {
  const [r] = await getDb()
    .select({ orderNo: serviceOrder.orderNo, status: workOrder.status })
    .from(workOrder)
    .innerJoin(serviceOrder, eq(serviceOrder.id, workOrder.orderId))
    .where(and(eq(workOrder.mainTechnicianId, techId), inArray(workOrder.status, [...ACTIVE_WORK_STATUSES])))
    .orderBy(desc(workOrder.updatedAt))
    .limit(1);
  return r ?? null;
}

/* ---------- F-TEC-WRK-01 출발 ---------- */

export type DepartResult = { departed: true; eta: string | null } | { departed: false; confirm: string };

export async function depart(techId: number, orderNo: string, force: boolean, now = new Date()): Promise<DepartResult> {
  const m = await mine(techId, orderNo);
  const db = getDb();
  const o = m.o;
  const today = kstDate(now);
  const [other] = await db
    .select({ orderNo: serviceOrder.orderNo })
    .from(workOrder)
    .innerJoin(serviceOrder, eq(serviceOrder.id, workOrder.orderId))
    .where(and(eq(workOrder.mainTechnicianId, techId), inArray(workOrder.status, [...ACTIVE_WORK_STATUSES]), ne(workOrder.orderId, o.id)))
    .limit(1);
  const check = checkDeparture({
    orderNo: o.orderNo,
    orderStatus: o.status,
    role: m.a.role,
    promisedDate: o.promisedAt ? kstDate(o.promisedAt) : null,
    today,
    otherActiveOrderNo: other?.orderNo ?? null,
    nextStopOrderNo: o.status === 'ASSIGNED' && m.a.role === 'MAIN' ? await nextRouteOrderNo(techId, today) : null,
  });
  if (!check.ok) throw new UserError(check.message);
  if (check.warning && !force) return { departed: false, confirm: check.warning };
  const here = await myLatestLocation(techId, now);
  const eta = await departureEta(techId, today, o.addressId, here ? { lat: here.lat, lng: here.lng } : null, now);
  const actor: Actor = { type: 'TECHNICIAN', id: techId };
  await db.transaction(async (tx) => {
    let w = await workOf(tx, o.id);
    if (!w) {
      assertWorkTransition(null, 'READY');
      const [created] = await tx
        .insert(workOrder)
        .values({ orderId: o.id, mainTechnicianId: techId, status: 'READY', createdBy: techId, updatedBy: techId })
        .returning();
      w = created!;
    } else if (w.mainTechnicianId !== techId) {
      await tx.update(workOrder).set({ mainTechnicianId: techId }).where(eq(workOrder.id, w.id));
    }
    await transitionWork(tx, w!, o, 'ON_THE_WAY', actor, { departedAt: now });
    await markRouteStop(tx, techId, o.id, today, { type: 'DEPART', eta }, now);
  });
  const [t] = await db.select({ name: technician.name, displayName: technician.displayName }).from(technician).where(eq(technician.id, techId));
  await notifyOrder('ON_THE_WAY', o.id, {
    기사명: t?.displayName || t?.name || '',
    도착예정: eta ? `${formatClock(eta)} 전후` : '곧 도착',
  });
  return { departed: true, eta: eta?.toISOString() ?? null };
}

/* ---------- F-TEC-WRK-02 도착 → 안전 체크 → 작업 시작 ---------- */

export async function arrive(techId: number, orderNo: string, now = new Date()) {
  const m = await mainOnly(techId, orderNo);
  const db = getDb();
  await db.transaction(async (tx) => {
    const w = await workOf(tx, m.o.id);
    if (!w) throw new UserError('먼저 출발을 눌러 주세요.');
    await transitionWork(tx, w, m.o, 'ARRIVED', { type: 'TECHNICIAN', id: techId }, { arrivedAt: now });
    await markRouteStop(tx, techId, m.o.id, kstDate(now), { type: 'ARRIVE' }, now);
  });
}

/** BR-043 네 항목을 모두 확인해야 작업 시작. 고소작업 혼자면 경고(막지 않음) */
export async function startWork(techId: number, orderNo: string, checked: string[], highPlaceWork: boolean, now = new Date()) {
  const m = await mainOnly(techId, orderNo);
  const r = checkSafety({ checked, highPlaceWork, teamSize: await teamSizeOf(m.o.id) });
  if (!r.ok) throw new UserError('안전 체크리스트를 모두 확인해야 작업을 시작할 수 있습니다.');
  await getDb().transaction(async (tx) => {
    const w = await workOf(tx, m.o.id);
    if (!w) throw new UserError('먼저 출발·도착을 눌러 주세요.');
    await transitionWork(tx, w, m.o, 'IN_PROGRESS', { type: 'TECHNICIAN', id: techId }, {
      safetyChecklistDone: true,
      highPlaceWork,
      startedAt: now,
    });
  });
  return { soloHighPlaceWarning: r.soloHighPlaceWarning };
}

/* ---------- F-TEC-WRK-03 작업 사진 ---------- */

const PHOTO_EDITABLE: readonly string[] = ['ARRIVED', 'IN_PROGRESS'];

export async function addPhoto(
  techId: number,
  v: { orderNo: string; photoType: string; orderItemId: number | null; unitNo: number | null; takenAt: string | null },
  file: File,
) {
  const m = await mainOnly(techId, v.orderNo);
  if (!file.type.startsWith('image/')) throw new UserError('사진 파일만 올릴 수 있습니다.');
  if (file.size > PHOTO_MAX_BYTES) throw new UserError('사진이 너무 큽니다(4MB 이하).');
  const w = await workOf(getDb(), m.o.id);
  if (!w || !PHOTO_EDITABLE.includes(w.status)) throw new UserError('도착 후 작업이 끝나기 전까지만 사진을 올릴 수 있습니다.');
  const deviceBound = v.photoType === 'BEFORE' || v.photoType === 'AFTER' || v.photoType === 'DURING';
  if (deviceBound || v.orderItemId !== null) {
    const { units } = await unitsOf(m.o);
    if (!units.some((u) => u.orderItemId === v.orderItemId && u.unitNo === v.unitNo))
      throw new UserError('어느 기기의 사진인지 골라 주세요.');
  }
  return getDb().transaction(async (tx) => {
    const a = await saveAttachment(file, 'WORK_PHOTO', w.id, { type: 'TECHNICIAN', id: techId }, tx);
    const [p] = await tx
      .insert(workPhoto)
      .values({
        workOrderId: w.id,
        orderItemId: v.orderItemId,
        unitNo: v.orderItemId !== null ? v.unitNo : null,
        photoType: v.photoType,
        fileId: a.id,
        takenAt: v.takenAt ? new Date(v.takenAt) : null,
        createdBy: techId,
        updatedBy: techId,
      })
      .returning();
    return { id: p!.id, photoType: p!.photoType, orderItemId: p!.orderItemId, unitNo: p!.unitNo, url: fileUrl(a.id) };
  });
}

export async function deletePhoto(techId: number, orderNo: string, photoId: number) {
  const m = await mainOnly(techId, orderNo);
  const db = getDb();
  const w = await workOf(db, m.o.id);
  if (!w || !PHOTO_EDITABLE.includes(w.status)) throw new UserError('작업이 끝난 뒤에는 사진을 지울 수 없습니다.');
  await db.transaction(async (tx) => {
    const [p] = await tx
      .delete(workPhoto)
      .where(and(eq(workPhoto.id, photoId), eq(workPhoto.workOrderId, w.id)))
      .returning();
    if (!p) throw new UserError('이미 지워진 사진입니다.');
    await tx.update(attachment).set({ deletedAt: new Date() }).where(eq(attachment.id, p.fileId));
  });
}

/* ---------- F-TEC-WRK-04·10 기기별 처리 결과 · 발견 이슈 ---------- */

export async function saveResults(
  techId: number,
  v: {
    orderNo: string;
    dirtLevel: string | null;
    issueFound: string | null;
    repairGuided: boolean;
    units: { orderItemId: number; unitNo: number; result: string; conditionNote: string | null; recommendNext: number | null }[];
  },
) {
  const m = await mainOnly(techId, v.orderNo);
  const db = getDb();
  const w = await workOf(db, m.o.id);
  if (!w || w.status !== 'IN_PROGRESS') throw new UserError('작업을 시작한 뒤에 결과를 입력할 수 있습니다.');
  const { units } = await unitsOf(m.o);
  const known = new Set(units.map((u) => `${u.orderItemId}:${u.unitNo}`));
  for (const u of v.units)
    if (!known.has(`${u.orderItemId}:${u.unitNo}`)) throw new UserError('그사이 주문 기기가 바뀌었습니다. 새로고침 후 다시 입력해 주세요.');
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const u of v.units) {
      await tx
        .insert(workResult)
        .values({ workOrderId: w.id, ...u, createdBy: techId, updatedBy: techId })
        .onConflictDoUpdate({
          target: [workResult.workOrderId, workResult.orderItemId, workResult.unitNo],
          set: { result: u.result, conditionNote: u.conditionNote, recommendNext: u.recommendNext, updatedAt: now, updatedBy: techId },
        });
    }
    await tx
      .update(workOrder)
      .set({ dirtLevel: v.dirtLevel, issueFound: v.issueFound, repairGuided: v.repairGuided, updatedAt: now, updatedBy: techId })
      .where(eq(workOrder.id, w.id));
  });
}

/* ---------- F-TEC-WRK-07 처리 저장(완료) ---------- */

export type CompleteResult = { done: true } | { done: false; problems: string[] };

export async function completeWork(
  techId: number,
  v: { orderNo: string; workNote: string; internalNote: string | null },
  signature: File | null,
  reportUrl: (orderNo: string) => string,
  now = new Date(),
): Promise<CompleteResult> {
  await mainOnly(techId, v.orderNo);
  const s = await getWorkState(techId, v.orderNo);
  if (!s?.work) throw new UserError('먼저 출발·도착·작업 시작을 눌러 주세요.');
  const check = await completionCheck(s, v.workNote);
  if (!check.ok) return { done: false, problems: check.problems.map((p) => p.message) };
  if (signature && (!signature.type.startsWith('image/') || signature.size > PHOTO_MAX_BYTES))
    throw new UserError('서명 이미지를 다시 그려 주세요.');
  const w = s.work;
  const results = s.results.map((r) => r.result);
  const db = getDb();
  const [o] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, s.orderId));
  // 작업비 = 주문 금액(상품·옵션·할증·할인 반영). 동의된 추가요금·자재·현장 할인은 단계 5-2·9에서 붙는다(BR-040)
  const agreedExtra = 0;
  const final = finalAmount({ laborAmount: o!.totalAmount, agreedExtra, materialAmount: w.materialAmount, discountAmount: w.discountAmount });
  await db.transaction(async (tx) => {
    const sig = signature ? await saveAttachment(signature, 'SIGNATURE', w.id, { type: 'TECHNICIAN', id: techId }, tx) : null;
    // 주문 항목 상태: 한 대라도 작업했으면 DONE, 모두 불가면 SKIPPED (상품 항목만)
    for (const it of new Set(s.units.map((u) => u.orderItemId))) {
      const rs = s.results.filter((r) => r.orderItemId === it);
      const status = itemStatusFromResults(rs.map((r) => r.result));
      const skipNote = status === 'SKIPPED' ? rs.map((r) => r.conditionNote).filter(Boolean).join(' / ').slice(0, 200) || '현장 작업 불가' : null;
      await tx.update(orderItem).set({ itemStatus: status, skipReason: skipNote }).where(eq(orderItem.id, it));
    }
    await transitionWork(
      tx,
      w,
      o!,
      'DONE',
      { type: 'TECHNICIAN', id: techId },
      {
        finishedAt: now,
        workMinutes: workMinutes(w.startedAt, now),
        resultCode: resultCodeFromResults(results, w.repairGuided),
        workNote: v.workNote,
        internalNote: v.internalNote,
        customerSignatureFileId: sig?.id ?? null,
        laborAmount: o!.totalAmount,
        extraAmount: agreedExtra,
        finalAmount: final,
      },
      { completedAt: now, extraAmount: agreedExtra, totalAmount: final },
    );
    await markRouteStop(tx, techId, o!.id, kstDate(now), { type: 'DONE' }, now);
  });
  await notifyOrder('WORK_DONE', o!.id, { 리포트링크: reportUrl(o!.orderNo) });
  return { done: true };
}

/* ---------- F-TEC-WRK-09 활동내역 ---------- */

export async function addActivity(techId: number, v: { orderNo: string; activityType: string; content: string }) {
  const m = await mine(techId, v.orderNo);
  await getDb().insert(activityLog).values({
    orderId: m.o.id,
    actorType: 'TECHNICIAN',
    actorId: techId,
    activityType: v.activityType,
    content: v.content,
  });
}

export async function listActivities(orderId: number) {
  return getDb()
    .select({
      id: activityLog.id,
      activityType: activityLog.activityType,
      content: activityLog.content,
      actorType: activityLog.actorType,
      createdAt: activityLog.createdAt,
      techName: technician.name,
    })
    .from(activityLog)
    .leftJoin(technician, and(eq(activityLog.actorType, 'TECHNICIAN'), eq(technician.id, activityLog.actorId)))
    .where(eq(activityLog.orderId, orderId))
    .orderBy(desc(activityLog.createdAt))
    .limit(100);
}

/* ---------- F-CUS-ORD-05 작업 리포트 (C-ORD-050) ---------- */

/** 고객 본인 주문 + 작업완료 이후에만. 안전관리·증빙 사진과 내부 메모는 보여 주지 않는다 */
export async function getWorkReport(customerId: number, orderNo: string) {
  const db = getDb();
  const [o] = await db
    .select()
    .from(serviceOrder)
    .where(and(eq(serviceOrder.orderNo, orderNo), eq(serviceOrder.customerId, customerId), isNull(serviceOrder.deletedAt)));
  if (!o || !canSeeWorkReport(o.status)) return null;
  const w = await workOf(db, o.id);
  if (!w || w.status !== 'DONE') return null;
  const [{ units }, results, photos, [t]] = await Promise.all([
    unitsOf(o),
    db.select().from(workResult).where(eq(workResult.workOrderId, w.id)),
    db
      .select()
      .from(workPhoto)
      .where(and(eq(workPhoto.workOrderId, w.id), inArray(workPhoto.photoType, ['BEFORE', 'DURING', 'AFTER', 'ISSUE'])))
      .orderBy(asc(workPhoto.id)),
    db.select({ name: technician.name, displayName: technician.displayName }).from(technician).where(eq(technician.id, w.mainTechnicianId)),
  ]);
  const key = (a: { orderItemId: number | null; unitNo: number | null }) => `${a.orderItemId}:${a.unitNo}`;
  return {
    orderNo: o.orderNo,
    finishedAt: w.finishedAt,
    workMinutes: w.workMinutes,
    techName: t ? t.displayName || t.name : '',
    workNote: w.workNote,
    issueFound: w.issueFound,
    repairGuided: w.repairGuided,
    dirtLevel: w.dirtLevel,
    devices: units.map((u) => {
      const r = results.find((x) => key(x) === key(u));
      return {
        ...u,
        result: r?.result ?? null,
        conditionNote: r?.conditionNote ?? null,
        recommendNext: r?.recommendNext ?? null,
        photos: photos.filter((p) => key(p) === key(u)).map((p) => ({ id: p.id, photoType: p.photoType, url: fileUrl(p.fileId) })),
      };
    }),
    issuePhotos: photos.filter((p) => p.orderItemId === null).map((p) => ({ id: p.id, photoType: p.photoType, url: fileUrl(p.fileId) })),
  };
}

/* ---------- /api/files/{id} 권한 ---------- */

/** 첨부파일을 볼 수 있는지: 기사 = 그 주문에 확정 배정, 고객 = 본인 주문 + 리포트 공개 이후(안전·증빙·서명 제외) */
export async function canViewAttachment(
  a: { refType: string; refId: number | null },
  viewer: { type: 'TECHNICIAN' | 'CUSTOMER'; id: number },
  photoType: string | null,
): Promise<boolean> {
  if ((a.refType !== 'WORK_PHOTO' && a.refType !== 'SIGNATURE') || a.refId === null) return false;
  const db = getDb();
  const [row] = await db
    .select({ orderNo: serviceOrder.orderNo, customerId: serviceOrder.customerId, status: serviceOrder.status })
    .from(workOrder)
    .innerJoin(serviceOrder, eq(serviceOrder.id, workOrder.orderId))
    .where(eq(workOrder.id, a.refId));
  if (!row) return false;
  if (viewer.type === 'TECHNICIAN') return Boolean(await myAssignment(viewer.id, row.orderNo));
  return (
    row.customerId === viewer.id &&
    canSeeWorkReport(row.status) &&
    a.refType === 'WORK_PHOTO' &&
    photoType !== null &&
    ['BEFORE', 'DURING', 'AFTER', 'ISSUE'].includes(photoType)
  );
}

export async function photoTypeOfFile(fileId: number): Promise<string | null> {
  const [p] = await getDb().select({ t: workPhoto.photoType }).from(workPhoto).where(eq(workPhoto.fileId, fileId));
  return p?.t ?? null;
}

/** 작업 상세 화면 요약 (T-JOB-020 [작업 시작/이어서] 버튼) */
export async function workSummary(orderId: number) {
  const w = await workOf(getDb(), orderId);
  return w ? { status: w.status } : null;
}
