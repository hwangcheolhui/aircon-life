import 'server-only';
/**
 * 독촉·전달 서버 서비스 (단계 8-1): F-ADM-CSL-11(A-CSL-030) · F-TEC-NTF-02(T-NTF-020) · F-ADM-PRC-08(A-PRC-060).
 * - 상담 독촉(CONSULT) = 지정한 관리자에게, 출장 독촉(ORDER) = 주문 주기사에게(없으면 지정한 관리자) 앱 알림.
 * - 같은 주문 기준 독촉 회차 자동 증가(nextFollowupCount). 상태는 domain 전이표(assertFollowupTransition).
 * - 기록은 상담(FOLLOWUP, 완료) 1건 + followup_request 1건. 거점 범위(BR-102)는 주문 거점(없으면 고객 주소 거점).
 */
import type { followupInput, z } from '@aircon/contracts';
import { adminUser, callLog, consultation, customer, followupRequest, serviceOrder, technician } from '@aircon/db';
import {
  type BranchFilter,
  ACTIVE_ORDER_STATUSES,
  assertFollowupTransition,
  checkFollowupInput,
  followupReceiverOf,
  maskName,
  nextFollowupCount,
} from '@aircon/domain';
import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { UserError } from './action-result';
import { assertCustomerInScope, insertConsultation } from './consult';
import { getDb } from './db';
import { notifyStaffWith } from './notify';
import { type Actor, isUniqueViolation } from './orders';
import { decrypt } from './pii';
import { assertInScope, customerBranchOf, mainTechOf, scopeCond } from './voc';

/** A-CSL-030 대상 주문 목록 (구분·상태·번호·약속일시·독촉회차) */
export async function followupTargets(customerId: number, filter: BranchFilter) {
  await assertCustomerInScope(customerId, filter);
  const db = getDb();
  const orders = await db
    .select({ id: serviceOrder.id, orderNo: serviceOrder.orderNo, status: serviceOrder.status, promisedAt: serviceOrder.promisedAt, orderType: serviceOrder.orderType })
    .from(serviceOrder)
    .where(and(eq(serviceOrder.customerId, customerId), isNull(serviceOrder.deletedAt), inArray(serviceOrder.status, [...ACTIVE_ORDER_STATUSES, 'WORK_DONE', 'PENDING'])))
    .orderBy(desc(serviceOrder.promisedAt))
    .limit(50);
  const counts = orders.length
    ? await db.select({ orderId: followupRequest.targetOrderId, n: followupRequest.followupCount }).from(followupRequest).where(inArray(followupRequest.targetOrderId, orders.map((o) => o.id)))
    : [];
  const admins = await db
    .select({ id: adminUser.id, name: adminUser.name })
    .from(adminUser)
    .where(and(isNull(adminUser.deletedAt), eq(adminUser.status, 'ACTIVE')));
  return {
    orders: orders.map((o) => ({ ...o, followupCount: Math.max(0, ...counts.filter((c) => c.orderId === o.id).map((c) => c.n)) })),
    admins,
  };
}

/** F-ADM-CSL-11 독촉/전달 저장 → 앱 알림 */
export async function createFollowup(input: z.output<typeof followupInput>, filter: BranchFilter, actor: Actor, now = new Date()) {
  await assertCustomerInScope(input.customerId, filter);
  const err = checkFollowupInput({ targetType: input.targetType, targetOrderId: input.targetOrderId, message: input.message, receiverAdminId: input.receiverAdminId });
  if (err) throw new UserError(err);
  const db = getDb();
  let orderNo = '';
  let branchId: number | null = null;
  let mainTech: number | null = null;
  if (input.targetType === 'ORDER') {
    const [o] = await db.select().from(serviceOrder).where(and(eq(serviceOrder.id, input.targetOrderId!), eq(serviceOrder.customerId, input.customerId)));
    if (!o) throw new UserError('대상 주문을 찾을 수 없습니다.');
    assertInScope(filter, o.branchId);
    orderNo = o.orderNo;
    branchId = o.branchId;
    mainTech = await mainTechOf(db, o.id);
  } else {
    branchId = await customerBranchOf(db, input.customerId);
  }
  const receiver = followupReceiverOf({ targetType: input.targetType, mainTechId: mainTech, receiverAdminId: input.receiverAdminId });
  if (!receiver) throw new UserError('배정된 기사가 없습니다. 받을 담당자를 고르세요.');
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await db.transaction(async (tx) => {
        const prev = input.targetOrderId
          ? await tx.select({ n: followupRequest.followupCount }).from(followupRequest).where(eq(followupRequest.targetOrderId, input.targetOrderId))
          : [];
        const count = input.targetType === 'ORDER' ? nextFollowupCount(prev.map((p) => p.n)) : 1;
        const cons = await insertConsultation(
          tx,
          now,
          attempt,
          {
            customerId: input.customerId,
            callLogId: input.callLogId,
            consultType: 'FOLLOWUP',
            subType: input.followupType,
            relatedOrderId: input.targetOrderId,
            content: input.message,
            status: 'DONE',
          },
          actor,
        );
        assertFollowupTransition(null, 'SENT');
        const [row] = await tx
          .insert(followupRequest)
          .values({
            consultationId: cons.id,
            targetType: input.targetType,
            targetOrderId: input.targetType === 'ORDER' ? input.targetOrderId : null,
            branchId,
            followupCount: count,
            followupType: input.followupType,
            cause: input.cause,
            message: input.message,
            receiverTechId: receiver.techId,
            receiverAdminId: receiver.adminId,
            status: 'SENT',
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning({ id: followupRequest.id });
        if (input.callLogId) await tx.update(callLog).set({ endedAt: now, updatedAt: now, updatedBy: actor.id }).where(eq(callLog.id, input.callLogId));
        return { id: row!.id, count };
      });
      const vars = { 접수번호: orderNo, 독촉회차: String(out.count), 전달내용: input.message };
      if (receiver.techId) await notifyStaffWith('FOLLOWUP_SENT', { type: 'TECHNICIAN', id: receiver.techId }, { type: 'FOLLOWUP', id: out.id }, vars, `/tech/notifications/followups/${out.id}`);
      else await notifyStaffWith('FOLLOWUP_ADMIN', { type: 'ADMIN', id: receiver.adminId }, { type: 'FOLLOWUP', id: out.id }, vars, '/admin/prc/followups');
      return out;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) continue;
      throw e;
    }
  }
}

export interface FollowupListQuery {
  status: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

/** F-ADM-PRC-08 독촉·전달 현황 (발송·읽음·회신) */
export async function listFollowups(filter: BranchFilter, q: FollowupListQuery) {
  const db = getDb();
  const rows = await db
    .select({ f: followupRequest, orderNo: serviceOrder.orderNo, techName: technician.name, adminName: adminUser.name, customerName: customer.name, consultNo: consultation.consultNo })
    .from(followupRequest)
    .innerJoin(consultation, eq(consultation.id, followupRequest.consultationId))
    .leftJoin(customer, eq(customer.id, consultation.customerId))
    .leftJoin(serviceOrder, eq(serviceOrder.id, followupRequest.targetOrderId))
    .leftJoin(technician, eq(technician.id, followupRequest.receiverTechId))
    .leftJoin(adminUser, eq(adminUser.id, followupRequest.receiverAdminId))
    .where(
      and(
        scopeCond(filter, followupRequest.branchId),
        q.status ? eq(followupRequest.status, q.status) : undefined,
        q.dateFrom ? gte(followupRequest.createdAt, new Date(`${q.dateFrom}T00:00:00+09:00`)) : undefined,
        q.dateTo ? lte(followupRequest.createdAt, new Date(`${q.dateTo}T23:59:59+09:00`)) : undefined,
      ),
    )
    .orderBy(desc(followupRequest.createdAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.f.id,
    consultNo: r.consultNo,
    targetType: r.f.targetType,
    orderNo: r.orderNo,
    followupCount: r.f.followupCount,
    followupType: r.f.followupType,
    cause: r.f.cause,
    message: r.f.message,
    receiver: r.techName ? `${r.techName} 기사` : (r.adminName ?? '-'),
    customerName: maskName(decrypt(r.customerName)),
    status: r.f.status,
    reply: r.f.reply,
    createdAt: r.f.createdAt,
    readAt: r.f.readAt,
    repliedAt: r.f.repliedAt,
  }));
}

/** A-PRC-060 종결 */
export async function closeFollowup(id: number, filter: BranchFilter, actor: Actor, now = new Date()) {
  const db = getDb();
  const [f] = await db.select().from(followupRequest).where(eq(followupRequest.id, id));
  if (!f) throw new UserError('독촉·전달을 찾을 수 없습니다.');
  assertInScope(filter, f.branchId);
  assertFollowupTransition(f.status, 'CLOSED');
  await db.update(followupRequest).set({ status: 'CLOSED', updatedAt: now, updatedBy: actor.id }).where(and(eq(followupRequest.id, id), eq(followupRequest.status, f.status)));
}

/* ---------- 기사 앱 (T-NTF-010·020) ---------- */

export async function listTechFollowups(techId: number) {
  return getDb()
    .select({
      id: followupRequest.id,
      status: followupRequest.status,
      followupCount: followupRequest.followupCount,
      message: followupRequest.message,
      createdAt: followupRequest.createdAt,
      orderNo: serviceOrder.orderNo,
    })
    .from(followupRequest)
    .leftJoin(serviceOrder, eq(serviceOrder.id, followupRequest.targetOrderId))
    .where(eq(followupRequest.receiverTechId, techId))
    .orderBy(desc(followupRequest.createdAt))
    .limit(50);
}

/** T-NTF-020 상세: 처음 열면 읽음(READ) */
export async function openTechFollowup(techId: number, id: number, now = new Date()) {
  const db = getDb();
  const [r] = await db
    .select({ f: followupRequest, orderNo: serviceOrder.orderNo, promisedAt: serviceOrder.promisedAt, orderStatus: serviceOrder.status })
    .from(followupRequest)
    .leftJoin(serviceOrder, eq(serviceOrder.id, followupRequest.targetOrderId))
    .where(and(eq(followupRequest.id, id), eq(followupRequest.receiverTechId, techId)));
  if (!r) return null;
  if (r.f.status === 'SENT') {
    assertFollowupTransition('SENT', 'READ');
    await db.update(followupRequest).set({ status: 'READ', readAt: now, updatedAt: now, updatedBy: techId }).where(and(eq(followupRequest.id, id), eq(followupRequest.status, 'SENT')));
    r.f.status = 'READ';
    r.f.readAt = now;
  }
  return { ...r.f, orderNo: r.orderNo, promisedAt: r.promisedAt, orderStatus: r.orderStatus };
}

/** F-TEC-NTF-02 회신 → 보낸 상담원에게 앱 알림 */
export async function replyTechFollowup(techId: number, id: number, reply: string, now = new Date()) {
  const db = getDb();
  const [f] = await db.select().from(followupRequest).where(and(eq(followupRequest.id, id), eq(followupRequest.receiverTechId, techId)));
  if (!f) throw new UserError('전달 내용을 찾을 수 없습니다.');
  assertFollowupTransition(f.status, 'REPLIED');
  const done = await db
    .update(followupRequest)
    .set({ status: 'REPLIED', reply, repliedAt: now, readAt: f.readAt ?? now, updatedAt: now, updatedBy: techId })
    .where(and(eq(followupRequest.id, id), eq(followupRequest.status, f.status)))
    .returning({ id: followupRequest.id });
  if (done.length === 0) throw new UserError('이미 회신한 전달입니다.');
  const [o] = f.targetOrderId ? await db.select({ orderNo: serviceOrder.orderNo }).from(serviceOrder).where(eq(serviceOrder.id, f.targetOrderId)) : [];
  await notifyStaffWith('FOLLOWUP_REPLIED', { type: 'ADMIN', id: f.createdBy }, { type: 'FOLLOWUP', id: f.id }, { 접수번호: o?.orderNo ?? '', 회신: reply }, '/admin/prc/followups');
}

/** 기사 홈 배지용: 아직 회신하지 않은 독촉 건수 */
export async function techOpenFollowupCount(techId: number) {
  const rows = await getDb()
    .select({ id: followupRequest.id })
    .from(followupRequest)
    .where(and(eq(followupRequest.receiverTechId, techId), inArray(followupRequest.status, ['SENT', 'READ'])));
  return rows.length;
}
