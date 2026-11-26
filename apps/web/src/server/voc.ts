import 'server-only';
/**
 * VOC·AS 서버 서비스 (단계 8-1): F-ADM-VOC-01(A-VOC-010·011) · F-ADM-VOC-03(A-VOC-030) · F-CUS-AS-01(C-AS-010).
 * - 상태 변경은 domain 전이표(assertVocTransition·assertAsTransition)를 거친다. VOC 는 voc_history 에 1행 INSERT(INSERT ONLY).
 * - BR-050 보증 판정(asWarrantyOf), 무상이면 재방문 주문 금액 0원(revisitOrderItems). BR-051 귀책 기사 = 원 주문 주기사.
 * - 거점 범위(BR-102): voc.branch_id·as_request.branch_id(원 주문 거점). 호출한 액션·페이지가 먼저 화면 권한을 확인한다.
 */
import type { adminAsInput, asDecisionInput, asRevisitInput, customerAsInput, vocCreateInput, vocUpdateInput, z } from '@aircon/contracts';
import {
  adminUser,
  asRequest,
  assignment,
  bookSlots,
  consultation,
  customer,
  orderItem,
  orderStatusHistory,
  serviceOrder,
  serviceProduct,
  technician,
  voc,
  vocHistory,
} from '@aircon/db';
import {
  type BranchFilter,
  CONFIRMED_ASSIGN_STATUSES,
  OPEN_AS_STATUSES,
  OPEN_CONSULT_STATUSES,
  assertAsTransition,
  assertConsultTransition,
  assertOrderTransition,
  assertVocTransition,
  asWarrantyOf,
  canRequestAs,
  checkVocClose,
  claimCategoryOf,
  defaultVocAlert,
  formatAfterNo,
  maskName,
  orderStatusHistoryRow,
  revisitOrderItems,
  slotHoursFor,
  validatePromisedAt,
} from '@aircon/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { UserError } from './action-result';
import { saveAttachment } from './attachments';
import { getDb } from './db';
import { notifyOrder } from './notify';
import { type Actor, type Tx, isUniqueViolation, nextOrderNo, scheduleColumns } from './orders';
import { decrypt } from './pii';

type Db = ReturnType<typeof getDb>;

/** 거점 범위 조건 (branch_id 가 없는 건은 전체 범위 관리자만) */
export function scopeCond(filter: BranchFilter, col: Parameters<typeof eq>[0]): SQL | undefined {
  if (filter.kind === 'ALL') return undefined;
  if (filter.kind === 'NONE') return sql`false`;
  return eq(col, filter.branchId);
}
export function assertInScope(filter: BranchFilter, branchId: number | null) {
  if (filter.kind === 'ALL') return;
  if (filter.kind === 'NONE' || branchId !== filter.branchId) throw new UserError('다른 거점 데이터는 처리할 수 없습니다.');
}

/** 그날 다음 번호 (V·S·A + YYMMDD + 4자리) */
export async function nextAfterNo(tx: Tx | Db, prefix: 'V' | 'S' | 'A', now: Date, bump = 0) {
  const head = formatAfterNo(prefix, now, 1).slice(0, 7);
  const q =
    prefix === 'V'
      ? sql`select voc_no as no from voc where voc_no like ${`${head}%`} order by voc_no desc limit 1`
      : prefix === 'A'
        ? sql`select as_no as no from as_request where as_no like ${`${head}%`} order by as_no desc limit 1`
        : sql`select incident_no as no from safety_incident where incident_no like ${`${head}%`} order by incident_no desc limit 1`;
  const rows = (await tx.execute(q)) as unknown as { no: string }[];
  const last = rows[0]?.no;
  return formatAfterNo(prefix, now, (last ? Number(last.slice(7)) : 0) + 1 + bump);
}

/** 주문의 확정 주기사 */
export async function mainTechOf(tx: Tx | Db, orderId: number): Promise<number | null> {
  const [a] = await tx
    .select({ techId: assignment.technicianId })
    .from(assignment)
    .where(and(eq(assignment.orderId, orderId), eq(assignment.role, 'MAIN'), inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES])))
    .orderBy(desc(assignment.id))
    .limit(1);
  return a?.techId ?? null;
}

/** 고객 기본 주소의 거점 (주문이 없는 VOC·안전사고의 거점 범위) */
export async function customerBranchOf(tx: Tx | Db, customerId: number): Promise<number | null> {
  const r = await tx.execute<{ branch_id: number | null }>(
    sql`select branch_id from customer_address where customer_id = ${customerId} and deleted_at is null order by is_default desc, updated_at desc limit 1`,
  );
  const v = (r as unknown as { branch_id: number | string | null }[])[0]?.branch_id;
  return v == null ? null : Number(v);
}

/* ---------- VOC ---------- */

/** VOC 1건 생성 + 첫 이력 (상담 클레임·관리자 등록·1:1 문의 전환이 함께 쓴다) */
export async function insertVocInTx(
  tx: Tx,
  now: Date,
  bump: number,
  v: {
    consultationId: number | null;
    customerId: number;
    orderId: number | null;
    channel: string;
    vocType: string;
    subType?: string | null;
    categoryL?: string | null;
    categoryM?: string | null;
    title?: string | null;
    content: string;
    severity?: string | null;
  },
  actor: Actor,
) {
  assertVocTransition(null, 'RECEIVED');
  let orderBranch: number | null = null;
  let techId: number | null = null;
  if (v.orderId) {
    const [o] = await tx.select({ branchId: serviceOrder.branchId }).from(serviceOrder).where(eq(serviceOrder.id, v.orderId));
    orderBranch = o?.branchId ?? null;
    techId = await mainTechOf(tx, v.orderId);
  }
  const branchId = orderBranch ?? (await customerBranchOf(tx, v.customerId));
  const cat = v.categoryL ? { l: v.categoryL, m: v.categoryM ?? null } : v.subType !== undefined ? claimCategoryOf(v.subType) : { l: null, m: null };
  const vocNo = await nextAfterNo(tx, 'V', now, bump);
  const [row] = await tx
    .insert(voc)
    .values({
      vocNo,
      consultationId: v.consultationId,
      customerId: v.customerId,
      orderId: v.orderId,
      technicianId: techId,
      branchId,
      channel: v.channel,
      vocType: v.vocType,
      categoryL: cat.l,
      categoryM: cat.m,
      title: (v.title ?? v.content.split('\n')[0] ?? '').slice(0, 200) || '(제목 없음)',
      content: v.content,
      severity: v.severity ?? null,
      isAlert: defaultVocAlert(v.severity),
      status: 'RECEIVED',
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning({ id: voc.id });
  await tx.insert(vocHistory).values({ vocId: row!.id, fromStatus: null, toStatus: 'RECEIVED', memo: null, actorType: actor.type, actorId: actor.id });
  if (techId) await refreshVocCount(tx, techId);
  return { id: row!.id, vocNo };
}

/** 기사 누적 VOC(불만) 건수 갱신 (technician.voc_count, F-SYS-11 집계와 같은 식) */
export async function refreshVocCount(tx: Tx | Db, techId: number) {
  await tx.execute(
    sql`update technician set voc_count = (select count(*) from voc where technician_id = ${techId} and voc_type = 'COMPLAINT') where id = ${techId}`,
  );
}

/** A-VOC-010 VOC 등록 (접수번호로 고객·기사 연결) */
export async function createVoc(input: z.output<typeof vocCreateInput>, filter: BranchFilter, actor: Actor, now = new Date()) {
  const db = getDb();
  const [o] = await db.select().from(serviceOrder).where(eq(serviceOrder.orderNo, input.orderNo));
  if (!o) throw new UserError('접수번호에 해당하는 주문이 없습니다.');
  assertInScope(filter, o.branchId);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction((tx) =>
        insertVocInTx(
          tx,
          now,
          attempt,
          {
            consultationId: null,
            customerId: o.customerId,
            orderId: o.id,
            channel: input.channel,
            vocType: input.vocType,
            categoryL: input.categoryL,
            categoryM: input.categoryM,
            title: input.title,
            content: input.content,
            severity: input.severity,
          },
          actor,
        ),
      );
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) continue;
      throw e;
    }
  }
}

export interface VocListQuery {
  status: string | null;
  categoryL: string | null;
  severity: string | null;
  alertOnly: boolean;
  dateFrom: string | null;
  dateTo: string | null;
}

/** F-ADM-VOC-01 VOC 목록 (고객 이름 마스킹, BR-100) */
export async function listVocs(filter: BranchFilter, q: VocListQuery) {
  const rows = await getDb()
    .select({ v: voc, orderNo: serviceOrder.orderNo, techName: technician.name, customerName: customer.name, handlerName: adminUser.name })
    .from(voc)
    .innerJoin(customer, eq(customer.id, voc.customerId))
    .leftJoin(serviceOrder, eq(serviceOrder.id, voc.orderId))
    .leftJoin(technician, eq(technician.id, voc.technicianId))
    .leftJoin(adminUser, eq(adminUser.id, voc.handlerAdminId))
    .where(
      and(
        scopeCond(filter, voc.branchId),
        q.status ? eq(voc.status, q.status) : undefined,
        q.categoryL ? eq(voc.categoryL, q.categoryL) : undefined,
        q.severity ? eq(voc.severity, q.severity) : undefined,
        q.alertOnly ? eq(voc.isAlert, true) : undefined,
        q.dateFrom ? gte(voc.createdAt, new Date(`${q.dateFrom}T00:00:00+09:00`)) : undefined,
        q.dateTo ? lte(voc.createdAt, new Date(`${q.dateTo}T23:59:59+09:00`)) : undefined,
      ),
    )
    .orderBy(desc(voc.createdAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.v.id,
    vocNo: r.v.vocNo,
    status: r.v.status,
    channel: r.v.channel,
    vocType: r.v.vocType,
    categoryL: r.v.categoryL,
    categoryM: r.v.categoryM,
    title: r.v.title,
    severity: r.v.severity,
    isAlert: r.v.isAlert,
    orderNo: r.orderNo,
    techName: r.techName,
    customerName: maskName(decrypt(r.customerName)),
    handlerName: r.handlerName,
    createdAt: r.v.createdAt,
    closedAt: r.v.closedAt,
  }));
}

/** A-VOC-011 VOC 카드 */
export async function getVoc(id: number, filter: BranchFilter) {
  const db = getDb();
  const [r] = await db
    .select({ v: voc, orderNo: serviceOrder.orderNo, customerName: customer.name, customerNo: customer.customerNo, consultNo: consultation.consultNo })
    .from(voc)
    .innerJoin(customer, eq(customer.id, voc.customerId))
    .leftJoin(serviceOrder, eq(serviceOrder.id, voc.orderId))
    .leftJoin(consultation, eq(consultation.id, voc.consultationId))
    .where(and(eq(voc.id, id), scopeCond(filter, voc.branchId)));
  if (!r) throw new UserError('VOC를 찾을 수 없거나 조회 권한이 없습니다.');
  const [history, techs, admins, asRow] = await Promise.all([
    db
      .select({ h: vocHistory, actorName: adminUser.name })
      .from(vocHistory)
      .leftJoin(adminUser, and(eq(vocHistory.actorType, 'ADMIN'), eq(adminUser.id, vocHistory.actorId)))
      .where(eq(vocHistory.vocId, id))
      .orderBy(asc(vocHistory.createdAt)),
    db
      .select({ id: technician.id, name: technician.name })
      .from(technician)
      .where(and(isNull(technician.deletedAt), r.v.branchId ? eq(technician.branchId, r.v.branchId) : undefined))
      .orderBy(asc(technician.name)),
    db
      .select({ id: adminUser.id, name: adminUser.name })
      .from(adminUser)
      .where(and(isNull(adminUser.deletedAt), eq(adminUser.status, 'ACTIVE')))
      .orderBy(asc(adminUser.name)),
    r.v.linkedAsRequestId ? db.select({ asNo: asRequest.asNo, status: asRequest.status }).from(asRequest).where(eq(asRequest.id, r.v.linkedAsRequestId)) : Promise.resolve([]),
  ]);
  return {
    ...r.v,
    orderNo: r.orderNo,
    consultNo: r.consultNo,
    customerNo: r.customerNo,
    customerName: maskName(decrypt(r.customerName)),
    linkedAs: asRow[0] ?? null,
    history: history.map((h) => ({ ...h.h, actorName: h.actorName })),
    techs,
    admins,
  };
}

/** A-VOC-011 처리 저장: 상태 전이(완료 조건) + 이력 1행 + 귀책 기사 VOC 건수 갱신 */
export async function updateVoc(input: z.output<typeof vocUpdateInput>, filter: BranchFilter, actor: Actor, now = new Date()) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [v] = await tx.select().from(voc).where(eq(voc.id, input.id)).for('update');
    if (!v) throw new UserError('VOC를 찾을 수 없습니다.');
    assertInScope(filter, v.branchId);
    if (v.status === 'DONE') throw new UserError('완료된 VOC는 수정할 수 없습니다.');
    const changed = input.status !== v.status;
    if (changed) assertVocTransition(v.status, input.status);
    if (input.status === 'DONE') {
      const err = checkVocClose({ vocType: v.vocType, rootCause: input.rootCause, customerAction: input.customerAction });
      if (err) throw new UserError(err);
    }
    await tx
      .update(voc)
      .set({
        status: input.status,
        severity: input.severity,
        isAlert: input.isAlert,
        categoryL: input.categoryL,
        categoryM: input.categoryM,
        handlerAdminId: input.handlerAdminId,
        technicianId: input.technicianId,
        rootCause: input.rootCause,
        customerAction: input.customerAction,
        closedAt: input.status === 'DONE' ? now : null,
        updatedAt: now,
        updatedBy: actor.id,
      })
      .where(eq(voc.id, v.id));
    if (changed || input.memo) {
      await tx.insert(vocHistory).values({ vocId: v.id, fromStatus: v.status, toStatus: input.status, memo: input.memo, actorType: actor.type, actorId: actor.id });
    }
    // 클레임 상담도 함께 완료 (BR-022 Alert 해제)
    if (input.status === 'DONE' && v.consultationId) {
      const [c] = await tx.select().from(consultation).where(eq(consultation.id, v.consultationId));
      if (c && (OPEN_CONSULT_STATUSES as readonly string[]).includes(c.status)) {
        assertConsultTransition(c.status, 'DONE');
        await tx.update(consultation).set({ status: 'DONE', completedAt: now, updatedAt: now, updatedBy: actor.id }).where(eq(consultation.id, c.id));
      }
    }
    for (const t of new Set([v.technicianId, input.technicianId])) if (t) await refreshVocCount(tx, t);
  });
}

/** 상담 콘솔 VOC 이력 (A-CSL-060) */
export async function customerVocs(customerId: number) {
  return getDb()
    .select({ id: voc.id, vocNo: voc.vocNo, status: voc.status, vocType: voc.vocType, categoryL: voc.categoryL, title: voc.title, createdAt: voc.createdAt })
    .from(voc)
    .where(eq(voc.customerId, customerId))
    .orderBy(desc(voc.createdAt))
    .limit(100);
}

/* ---------- AS (BR-050·051) ---------- */

async function orderWarranty(db: Tx | Db, o: typeof serviceOrder.$inferSelect, now: Date) {
  const items = await db
    .select({ days: serviceProduct.warrantyDays })
    .from(orderItem)
    .leftJoin(serviceProduct, eq(serviceProduct.id, orderItem.productId))
    .where(and(eq(orderItem.orderId, o.id), eq(orderItem.itemType, 'PRODUCT')));
  let completedAt = o.completedAt;
  if (!completedAt) {
    // 작업완료(WORK_DONE)인데 결제 전이면 작업 완료 이력 시각
    const [h] = await db
      .select({ at: orderStatusHistory.createdAt })
      .from(orderStatusHistory)
      .where(and(eq(orderStatusHistory.orderId, o.id), eq(orderStatusHistory.toStatus, 'WORK_DONE')))
      .orderBy(desc(orderStatusHistory.createdAt))
      .limit(1);
    completedAt = h?.at ?? null;
  }
  return asWarrantyOf({ completedAt, warrantyDays: items.map((i) => i.days).filter((d): d is number => d != null), now });
}

async function openAsCount(db: Tx | Db, orderId: number) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(asRequest)
    .where(and(eq(asRequest.originalOrderId, orderId), inArray(asRequest.status, [...OPEN_AS_STATUSES])));
  return r?.n ?? 0;
}

/** C-AS-010 화면 정보: 보증 여부 표시·신청 가능 여부·이 주문의 AS 이력 */
export async function customerAsInfo(customerId: number, orderNo: string, now = new Date()) {
  const db = getDb();
  const [o] = await db.select().from(serviceOrder).where(and(eq(serviceOrder.orderNo, orderNo), eq(serviceOrder.customerId, customerId)));
  if (!o) return null;
  const [warranty, open, history] = await Promise.all([
    orderWarranty(db, o, now),
    openAsCount(db, o.id),
    db
      .select({ asNo: asRequest.asNo, status: asRequest.status, reason: asRequest.reason, isWarranty: asRequest.isWarranty, createdAt: asRequest.createdAt, handleNote: asRequest.handleNote })
      .from(asRequest)
      .where(eq(asRequest.originalOrderId, o.id))
      .orderBy(desc(asRequest.createdAt)),
  ]);
  return { orderId: o.id, orderNo: o.orderNo, warranty, allowed: canRequestAs({ orderStatus: o.status, orderType: o.orderType, openAsCount: open }), history };
}

async function insertAs(
  input: { orderId: number; reason: string; content: string | null; vocId?: number | null },
  actor: Actor,
  files: File[],
  now: Date,
) {
  const db = getDb();
  const [o] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, input.orderId));
  if (!o) throw new UserError('주문을 찾을 수 없습니다.');
  const allowed = canRequestAs({ orderStatus: o.status, orderType: o.orderType, openAsCount: await openAsCount(db, o.id) });
  if (!allowed.ok) throw new UserError(allowed.reason);
  const warranty = await orderWarranty(db, o, now);
  const techId = await mainTechOf(db, o.id);
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await db.transaction(async (tx) => {
        assertAsTransition(null, 'REQUESTED');
        const asNo = await nextAfterNo(tx, 'A', now, attempt);
        const [row] = await tx
          .insert(asRequest)
          .values({
            asNo,
            originalOrderId: o.id,
            customerId: o.customerId,
            branchId: o.branchId,
            reason: input.reason,
            content: input.content,
            isWarranty: warranty.isWarranty,
            warrantyUntil: warranty.until,
            responsibleTechId: techId,
            status: 'REQUESTED',
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning({ id: asRequest.id });
        const ids: number[] = [];
        for (const f of files.slice(0, 3)) {
          const a = await saveAttachment(f, 'AS_REQUEST', row!.id, { type: actor.type === 'CUSTOMER' ? 'CUSTOMER' : 'ADMIN', id: actor.id ?? 0 }, tx);
          ids.push(a.id);
        }
        if (ids.length) await tx.update(asRequest).set({ photoFileIds: ids.join(',') }).where(eq(asRequest.id, row!.id));
        if (input.vocId) await tx.update(voc).set({ linkedAsRequestId: row!.id, updatedAt: now, updatedBy: actor.id }).where(eq(voc.id, input.vocId));
        return { id: row!.id, asNo };
      });
      await notifyOrder('AS_RECEIVED', o.id, {
        AS번호: out.asNo,
        보증안내: warranty.isWarranty ? `보증기간(${warranty.until}까지) 안이라 무상으로 처리됩니다.` : '보증기간이 지나 유상으로 처리될 수 있습니다.',
      });
      return { ...out, isWarranty: warranty.isWarranty };
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) continue;
      throw e;
    }
  }
}

/** F-CUS-AS-01 고객 AS 요청 (사진 3장까지) */
export async function createCustomerAs(customerId: number, input: z.output<typeof customerAsInput>, files: File[], now = new Date()) {
  const [o] = await getDb().select({ id: serviceOrder.id }).from(serviceOrder).where(and(eq(serviceOrder.orderNo, input.orderNo), eq(serviceOrder.customerId, customerId)));
  if (!o) throw new UserError('예약을 찾을 수 없어요.');
  for (const f of files) {
    if (!f.type.startsWith('image/')) throw new UserError('사진 파일만 올릴 수 있어요.');
    if (f.size > 4 * 1024 * 1024) throw new UserError('사진은 4MB 이하로 올려 주세요.');
  }
  return insertAs({ orderId: o.id, reason: input.reason, content: input.content }, { type: 'CUSTOMER', id: customerId }, files, now);
}

/** A-VOC-030 관리자 AS 등록 (전화 접수·VOC 연결) */
export async function createAdminAs(input: z.output<typeof adminAsInput>, filter: BranchFilter, actor: Actor, now = new Date()) {
  const db = getDb();
  const [o] = await db.select().from(serviceOrder).where(eq(serviceOrder.orderNo, input.orderNo));
  if (!o) throw new UserError('접수번호에 해당하는 주문이 없습니다.');
  assertInScope(filter, o.branchId);
  if (input.vocId) {
    const [v] = await db.select({ customerId: voc.customerId }).from(voc).where(eq(voc.id, input.vocId));
    if (!v || v.customerId !== o.customerId) throw new UserError('VOC와 주문의 고객이 다릅니다.');
  }
  return insertAs({ orderId: o.id, reason: input.reason, content: input.content, vocId: input.vocId }, actor, [], now);
}

/** F-ADM-VOC-03 AS 목록 */
export async function listAs(filter: BranchFilter, status: string | null) {
  const rows = await getDb()
    .select({ a: asRequest, orderNo: serviceOrder.orderNo, customerName: customer.name, techName: technician.name })
    .from(asRequest)
    .innerJoin(serviceOrder, eq(serviceOrder.id, asRequest.originalOrderId))
    .innerJoin(customer, eq(customer.id, asRequest.customerId))
    .leftJoin(technician, eq(technician.id, asRequest.responsibleTechId))
    .where(and(scopeCond(filter, asRequest.branchId), status ? eq(asRequest.status, status) : undefined))
    .orderBy(desc(asRequest.createdAt))
    .limit(500);
  const newIds = rows.map((r) => r.a.newOrderId).filter((x): x is number => x !== null);
  const news = newIds.length
    ? await getDb().select({ id: serviceOrder.id, orderNo: serviceOrder.orderNo, status: serviceOrder.status, promisedAt: serviceOrder.promisedAt, totalAmount: serviceOrder.totalAmount }).from(serviceOrder).where(inArray(serviceOrder.id, newIds))
    : [];
  return rows.map((r) => ({
    id: r.a.id,
    asNo: r.a.asNo,
    status: r.a.status,
    reason: r.a.reason,
    content: r.a.content,
    isWarranty: r.a.isWarranty,
    warrantyUntil: r.a.warrantyUntil,
    photoIds: (r.a.photoFileIds ?? '').split(',').filter(Boolean).map(Number),
    handleNote: r.a.handleNote,
    orderNo: r.orderNo,
    customerName: maskName(decrypt(r.customerName)),
    techName: r.techName,
    newOrder: news.find((n) => n.id === r.a.newOrderId) ?? null,
    createdAt: r.a.createdAt,
  }));
}

/** F-ADM-VOC-03 승인(보증 판정 확정)·반려·완료 */
export async function decideAs(input: z.output<typeof asDecisionInput>, filter: BranchFilter, actor: Actor, now = new Date()) {
  const db = getDb();
  const [a] = await db.select().from(asRequest).where(eq(asRequest.id, input.id));
  if (!a) throw new UserError('AS 요청을 찾을 수 없습니다.');
  assertInScope(filter, a.branchId);
  const to = input.action === 'ACCEPT' ? 'ACCEPTED' : input.action === 'REJECT' ? 'REJECTED' : 'DONE';
  assertAsTransition(a.status, to);
  if (to === 'REJECTED' && !input.note) throw new UserError('반려 사유는 필수 입력값입니다.');
  if (to === 'DONE') {
    const [n] = a.newOrderId ? await db.select({ status: serviceOrder.status }).from(serviceOrder).where(eq(serviceOrder.id, a.newOrderId)) : [];
    if (!n || (n.status !== 'WORK_DONE' && n.status !== 'COMPLETED')) throw new UserError('재방문 작업이 끝난 뒤 완료할 수 있습니다.');
  }
  const done = await db
    .update(asRequest)
    .set({
      status: to,
      isWarranty: to === 'ACCEPTED' ? input.isWarranty : a.isWarranty,
      handledBy: actor.id,
      handleNote: input.note ?? a.handleNote,
      updatedAt: now,
      updatedBy: actor.id,
    })
    .where(and(eq(asRequest.id, a.id), eq(asRequest.status, a.status)))
    .returning({ id: asRequest.id });
  if (done.length === 0) throw new UserError('다른 곳에서 먼저 처리된 AS 요청입니다.');
  if (to === 'REJECTED') await notifyOrder('AS_REJECTED', a.originalOrderId, { AS번호: a.asNo, 사유: input.note ?? '' });
}

/**
 * F-ADM-VOC-03 재방문 주문 생성: 원 주문 고객·주소·거점, 주문 유형·채널 AS, parent_order_id = 원 주문.
 * BR-050 무상이면 금액 0원. 상태 RECEIVED + 슬롯 차감(BR-021) → 배정 보드(A-DSP-010)에 올라간다. AS 는 SCHEDULED.
 */
export async function createRevisitOrder(input: z.output<typeof asRevisitInput>, filter: BranchFilter, actor: Actor, now = new Date()) {
  const db = getDb();
  const [a] = await db.select().from(asRequest).where(eq(asRequest.id, input.id));
  if (!a) throw new UserError('AS 요청을 찾을 수 없습니다.');
  assertInScope(filter, a.branchId);
  assertAsTransition(a.status, 'SCHEDULED');
  const past = validatePromisedAt(input.slotDate, input.slotHour, now);
  if (past) throw new UserError(past);
  const [o] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, a.originalOrderId));
  if (!o) throw new UserError('원 주문을 찾을 수 없습니다.');
  const src = await db.select().from(orderItem).where(eq(orderItem.orderId, o.id));
  const items = revisitOrderItems(src, a.isWarranty);
  if (!items.length) throw new UserError('원 주문에 기기 항목이 없어 재방문 주문을 만들 수 없습니다.');
  const total = items.reduce((s, i) => s + i.amount, 0);
  const durationMin = o.requestedTimeFrom && o.requestedTimeTo ? Math.max(60, (Number(o.requestedTimeTo.slice(0, 2)) - Number(o.requestedTimeFrom.slice(0, 2))) * 60) : 60;
  const sched = scheduleColumns(input.slotDate, input.slotHour, durationMin);
  const hours = slotHoursFor(input.slotHour, durationMin);
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await db.transaction(async (tx) => {
        const orderNo = await nextOrderNo(tx, now, attempt);
        assertOrderTransition(null, 'RECEIVED');
        const [n] = await tx
          .insert(serviceOrder)
          .values({
            orderNo,
            customerId: o.customerId,
            addressId: o.addressId,
            branchId: o.branchId,
            parentOrderId: o.id,
            channel: 'AS',
            orderType: 'AS',
            status: 'RECEIVED',
            ...sched,
            visitType: 'IN_HOURS',
            requiredTechCount: 1,
            customerRequest: `[AS ${a.asNo}] ${a.content ?? ''}`.slice(0, 500),
            internalNote: a.isWarranty ? '보증기간 내 무상 AS (BR-050)' : '보증기간 경과 유상 AS',
            subtotalAmount: total,
            totalAmount: total,
            paymentStatus: 'UNPAID',
            isDuplicateChecked: true,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning({ id: serviceOrder.id });
        await tx.insert(orderItem).values(items.map((i) => ({ ...i, orderId: n!.id })));
        await tx
          .insert(orderStatusHistory)
          .values(orderStatusHistoryRow({ orderId: n!.id, from: null, to: 'RECEIVED', actorType: actor.type, actorId: actor.id, memo: `AS 재방문(${a.asNo})` }));
        if (!(await bookSlots(tx, { branchId: o.branchId, slotDate: input.slotDate, hours, units: 1 }))) {
          throw new UserError('선택한 시간에 남은 자리가 없습니다. 다른 시간을 골라 주세요.');
        }
        const moved = await tx
          .update(asRequest)
          .set({ status: 'SCHEDULED', newOrderId: n!.id, handledBy: actor.id, updatedAt: now, updatedBy: actor.id })
          .where(and(eq(asRequest.id, a.id), eq(asRequest.status, a.status)))
          .returning({ id: asRequest.id });
        if (moved.length === 0) throw new UserError('다른 곳에서 먼저 처리된 AS 요청입니다.');
        return { id: n!.id, orderNo };
      });
      await notifyOrder('AS_SCHEDULED', out.id);
      return out;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) continue;
      throw e;
    }
  }
}

/** F-SYS-11: 재방문 주문 작업이 끝난 AS 는 완료로 (시스템) */
export async function closeFinishedAs(now = new Date()): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: asRequest.id, status: asRequest.status })
    .from(asRequest)
    .innerJoin(serviceOrder, eq(serviceOrder.id, asRequest.newOrderId))
    .where(and(eq(asRequest.status, 'SCHEDULED'), inArray(serviceOrder.status, ['WORK_DONE', 'COMPLETED'])));
  for (const r of rows) {
    assertAsTransition(r.status, 'DONE');
    await db.update(asRequest).set({ status: 'DONE', updatedAt: now, updatedBy: null }).where(and(eq(asRequest.id, r.id), eq(asRequest.status, 'SCHEDULED')));
  }
  return rows.length;
}

/** AS 사진 열람 권한 (/api/files): 고객 본인 또는 A-VOC-030 조회 권한 + 거점 범위 */
export async function asFileOwner(attachmentRefId: number | null) {
  if (!attachmentRefId) return null;
  const [a] = await getDb().select({ customerId: asRequest.customerId, branchId: asRequest.branchId }).from(asRequest).where(eq(asRequest.id, attachmentRefId));
  return a ?? null;
}
