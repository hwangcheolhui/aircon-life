import 'server-only';
/**
 * 안전사고 서버 서비스 (단계 8-1): F-ADM-CSL-12(A-CSL-040) · F-ADM-VOC-02(A-VOC-020).
 * - BR-061 등록 시 거점장(ADM_BRANCH)·담당자(거점 ADM_OPS) 자동 수신자, 수신자 직접 추가(외부는 문자).
 * - BR-060 매체/기관에 언론·인터넷 → 화면 재확인(escalationConfirmed) 후 is_escalated + 경영진(ADM_SUPER) 자동 통보.
 * - 🔒 수동 수신자 연락처는 암호화 저장, 화면은 마스킹(BR-100). 진행 상태는 domain 전이표(assertIncidentTransition).
 */
import type { incidentInput, incidentRecipientInput, incidentUpdateInput, z } from '@aircon/contracts';
import { adminUser, callLog, customer, incidentRecipient, role, safetyIncident, serviceOrder, technician } from '@aircon/db';
import {
  type BranchFilter,
  assertIncidentTransition,
  autoIncidentRecipients,
  checkIncidentInput,
  maskName,
  maskPhone,
  needsEscalation,
  parseMediaFlags,
} from '@aircon/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { UserError } from './action-result';
import { assertCustomerInScope, insertConsultation } from './consult';
import { getDb } from './db';
import { notifyPhone, notifyStaffWith } from './notify';
import { type Actor, isUniqueViolation } from './orders';
import { decrypt, encrypt } from './pii';
import { assertInScope, customerBranchOf, mainTechOf, nextAfterNo, scopeCond } from './voc';

const DAMAGE_LABEL: Record<string, string> = {
  DEVICE_BREAK: '기기파손',
  WATER_LEAK: '누수',
  PROPERTY: '재산',
  INJURY: '인명',
  FIRE_ELECTRIC: '화재·전기',
};

/** 통보 1건 보내고 결과를 수신자 행에 남긴다 */
async function notifyRecipient(r: typeof incidentRecipient.$inferSelect, inc: { id: number; incidentNo: string; damageType: string }, now: Date) {
  const vars = { 사고번호: inc.incidentNo, 피해유형: DAMAGE_LABEL[inc.damageType] ?? inc.damageType };
  let result = 'SKIPPED';
  if (r.adminUserId) {
    await notifyStaffWith(r.recipientType === 'EXECUTIVE' ? 'SAFETY_ESCALATED' : 'SAFETY_INCIDENT', { type: 'ADMIN', id: r.adminUserId }, { type: 'INCIDENT', id: inc.id }, vars, '/admin/voc/incidents');
    result = 'SENT';
  } else if (r.phone) {
    result = await notifyPhone('SAFETY_INCIDENT', decrypt(r.phone) ?? '', vars, { type: 'INCIDENT', id: inc.id });
  }
  await getDb().update(incidentRecipient).set({ notifiedAt: result === 'SKIPPED' ? null : now, notifyResult: result, updatedAt: now }).where(eq(incidentRecipient.id, r.id));
}

/** F-ADM-CSL-12 안전사고 접수 */
export async function createIncident(input: z.output<typeof incidentInput>, filter: BranchFilter, actor: Actor, now = new Date()) {
  await assertCustomerInScope(input.customerId, filter);
  const err = checkIncidentInput(input);
  if (err) throw new UserError(err);
  const flags = parseMediaFlags(input.mediaFlags.join(','));
  const escalated = needsEscalation(flags);
  if (escalated && !input.escalationConfirmed) throw new UserError('언론·인터넷이 선택되어 경영진에게 통보됩니다. 다시 확인해 주세요.');
  const db = getDb();
  let branchId: number | null = null;
  let techId: number | null = null;
  if (input.orderId) {
    const [o] = await db.select().from(serviceOrder).where(and(eq(serviceOrder.id, input.orderId), eq(serviceOrder.customerId, input.customerId)));
    if (!o) throw new UserError('관련 주문을 찾을 수 없습니다.');
    branchId = o.branchId;
    techId = await mainTechOf(db, o.id);
  } else branchId = await customerBranchOf(db, input.customerId);
  if (branchId !== null) assertInScope(filter, branchId);
  const admins = await db
    .select({ id: adminUser.id, roleCode: role.roleCode, branchId: adminUser.branchId })
    .from(adminUser)
    .innerJoin(role, eq(role.id, adminUser.roleId))
    .where(and(isNull(adminUser.deletedAt), eq(adminUser.status, 'ACTIVE')));
  const auto = autoIncidentRecipients({ branchId, admins, escalated });
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await db.transaction(async (tx) => {
        const cons = await insertConsultation(
          tx,
          now,
          attempt,
          { customerId: input.customerId, callLogId: input.callLogId, consultType: 'SAFETY', subType: input.damageType, relatedOrderId: input.orderId, content: input.circumstance.slice(0, 1000), status: 'OPEN' },
          actor,
        );
        assertIncidentTransition(null, 'REPORTED');
        const incidentNo = await nextAfterNo(tx, 'S', now, attempt);
        const [inc] = await tx
          .insert(safetyIncident)
          .values({
            incidentNo,
            consultationId: cons.id,
            customerId: input.customerId,
            orderId: input.orderId,
            technicianId: techId,
            branchId,
            damageType: input.damageType,
            occurredAt: input.occurredAt ? new Date(`${input.occurredAt}:00+09:00`) : null,
            circumstance: input.circumstance,
            damageDetail: input.damageDetail,
            customerDemand: input.customerDemand,
            responseAction: input.responseAction,
            mediaFlags: flags.join(',') || null,
            isEscalated: escalated,
            status: 'REPORTED',
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning({ id: safetyIncident.id });
        const rows = [
          ...auto.map((a) => ({ incidentId: inc!.id, recipientType: a.recipientType, adminUserId: a.adminUserId, createdBy: actor.id, updatedBy: actor.id })),
          ...input.extraRecipients.map((r) => ({
            incidentId: inc!.id,
            recipientType: 'MANUAL',
            name: r.name,
            org: r.org,
            phone: encrypt(r.phone),
            email: r.email,
            createdBy: actor.id,
            updatedBy: actor.id,
          })),
        ];
        const recipients = rows.length ? await tx.insert(incidentRecipient).values(rows).returning() : [];
        if (input.callLogId) await tx.update(callLog).set({ endedAt: now, updatedAt: now, updatedBy: actor.id }).where(eq(callLog.id, input.callLogId));
        return { id: inc!.id, incidentNo, recipients };
      });
      for (const r of out.recipients) await notifyRecipient(r, { id: out.id, incidentNo: out.incidentNo, damageType: input.damageType }, now);
      return { id: out.id, incidentNo: out.incidentNo, escalated, recipientCount: out.recipients.length };
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) continue;
      throw e;
    }
  }
}

export interface IncidentListQuery {
  status: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

/** F-ADM-VOC-02 안전사고 목록 + 수신자 통보 이력 */
export async function listIncidents(filter: BranchFilter, q: IncidentListQuery) {
  const db = getDb();
  const rows = await db
    .select({ i: safetyIncident, orderNo: serviceOrder.orderNo, techName: technician.name, customerName: customer.name })
    .from(safetyIncident)
    .leftJoin(serviceOrder, eq(serviceOrder.id, safetyIncident.orderId))
    .leftJoin(technician, eq(technician.id, safetyIncident.technicianId))
    .leftJoin(customer, eq(customer.id, safetyIncident.customerId))
    .where(
      and(
        scopeCond(filter, safetyIncident.branchId),
        q.status ? eq(safetyIncident.status, q.status) : undefined,
        q.dateFrom ? gte(safetyIncident.createdAt, new Date(`${q.dateFrom}T00:00:00+09:00`)) : undefined,
        q.dateTo ? lte(safetyIncident.createdAt, new Date(`${q.dateTo}T23:59:59+09:00`)) : undefined,
      ),
    )
    .orderBy(desc(safetyIncident.createdAt))
    .limit(300);
  const ids = rows.map((r) => r.i.id);
  const recips = ids.length
    ? await db
        .select({ r: incidentRecipient, adminName: adminUser.name })
        .from(incidentRecipient)
        .leftJoin(adminUser, eq(adminUser.id, incidentRecipient.adminUserId))
        .where(inArray(incidentRecipient.incidentId, ids))
        .orderBy(asc(incidentRecipient.id))
    : [];
  return rows.map((r) => ({
    ...r.i,
    orderNo: r.orderNo,
    techName: r.techName,
    customerName: maskName(decrypt(r.customerName)),
    recipients: recips
      .filter((x) => x.r.incidentId === r.i.id)
      .map((x) => ({
        id: x.r.id,
        recipientType: x.r.recipientType,
        name: x.adminName ?? x.r.name ?? '-',
        org: x.r.org,
        phoneMasked: maskPhone(decrypt(x.r.phone)),
        email: x.r.email,
        notifiedAt: x.r.notifiedAt,
        notifyResult: x.r.notifyResult,
      })),
  }));
}

/** F-ADM-VOC-02 진행 상태·보험 접수번호·보상 금액 */
export async function updateIncident(input: z.output<typeof incidentUpdateInput>, filter: BranchFilter, actor: Actor, now = new Date()) {
  const db = getDb();
  const [i] = await db.select().from(safetyIncident).where(eq(safetyIncident.id, input.id));
  if (!i) throw new UserError('안전사고를 찾을 수 없습니다.');
  assertInScope(filter, i.branchId);
  if (i.status === 'CLOSED') throw new UserError('종결된 안전사고는 수정할 수 없습니다.');
  if (input.status !== i.status) assertIncidentTransition(i.status, input.status);
  if (input.status === 'COMPENSATED' && input.compensationAmount === null) throw new UserError('보상 금액은 필수 입력값입니다.');
  await db
    .update(safetyIncident)
    .set({
      status: input.status,
      insuranceClaimNo: input.insuranceClaimNo,
      compensationAmount: input.compensationAmount,
      responseAction: input.responseAction ?? i.responseAction,
      updatedAt: now,
      updatedBy: actor.id,
    })
    .where(and(eq(safetyIncident.id, i.id), eq(safetyIncident.status, i.status)));
}

/** 수신자 추가 + 통보 */
export async function addIncidentRecipient(input: z.output<typeof incidentRecipientInput>, filter: BranchFilter, actor: Actor, now = new Date()) {
  const db = getDb();
  const [i] = await db.select().from(safetyIncident).where(eq(safetyIncident.id, input.incidentId));
  if (!i) throw new UserError('안전사고를 찾을 수 없습니다.');
  assertInScope(filter, i.branchId);
  if (!input.phone && !input.email) throw new UserError('연락처 또는 이메일 중 하나는 필수 입력값입니다.');
  const [r] = await db
    .insert(incidentRecipient)
    .values({ incidentId: i.id, recipientType: 'MANUAL', name: input.name, org: input.org, phone: encrypt(input.phone), email: input.email, createdBy: actor.id, updatedBy: actor.id })
    .returning();
  await notifyRecipient(r!, i, now);
}

/** 상담 콘솔 보상이력 (A-CSL-060): 이 고객의 안전사고 */
export async function customerIncidents(customerId: number) {
  return getDb()
    .select({
      id: safetyIncident.id,
      incidentNo: safetyIncident.incidentNo,
      damageType: safetyIncident.damageType,
      status: safetyIncident.status,
      compensationAmount: safetyIncident.compensationAmount,
      createdAt: safetyIncident.createdAt,
    })
    .from(safetyIncident)
    .where(eq(safetyIncident.customerId, customerId))
    .orderBy(desc(safetyIncident.createdAt));
}
