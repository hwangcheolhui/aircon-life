import 'server-only';
/**
 * 개인정보 파기·감사 로그·일 집계 서버 서비스 (단계 8-2).
 * - F-ADM-CUS-05(A-CUS-030) 파기 대상 목록·일괄 파기 승인, F-SYS-12(03:00) 파기 배치(PURGE_APPROVAL_MODE=Y 면 대상만 남기고 대기).
 * - 파기 = 식별 컬럼 비식별화(이름 → '파기된 고객', 연락처 → '-', 해시·이메일·상세주소 등 NULL) + status PURGED.
 *   주문·결제 금액은 통계용으로 남긴다(ERD §6). 파기 1건마다 audit_log DELETE 1행(BR-100).
 * - F-ADM-SYS-06(A-SYS-060) 감사 로그 조회.
 * - F-SYS-11(02:00) 일 집계: 고객 최근 작업일·누적 주문·파기 예정일, 기사 VOC 건수, AS 완료, 캠페인 전환.
 */
import { adminUser, auditLog, callLog, customer, customerAddress, payment, serviceOrder, taxDocument } from '@aircon/db';
import { type BranchFilter, PURGED_NAME, SETTING_KEYS, maskName } from '@aircon/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { UserError } from './action-result';
import { writeAudit } from './audit';
import { customerScopeCond } from './consult';
import { refreshCampaignConversions } from './crm';
import { getDb } from './db';
import { decrypt, encrypt } from './pii';
import { getSettingNumber, getSettingString } from './settings';
import { closeFinishedAs } from './voc';

const kstToday = (now: Date) => now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

/* ---------- A-CUS-030 파기 대상 ---------- */

/** 파기 예정일이 오늘 이전(포함)인, 아직 파기 전 고객 */
export async function listPurgeTargets(filter: BranchFilter, now = new Date()) {
  const rows = await getDb()
    .select({
      id: customer.id,
      customerNo: customer.customerNo,
      name: customer.name,
      status: customer.status,
      lastServiceDate: customer.lastServiceDate,
      withdrawnAt: customer.withdrawnAt,
      purgeDueDate: customer.purgeDueDate,
      totalOrderCount: customer.totalOrderCount,
    })
    .from(customer)
    .where(and(ne(customer.status, 'PURGED'), lte(customer.purgeDueDate, kstToday(now)), customerScopeCond(filter)))
    .orderBy(asc(customer.purgeDueDate), asc(customer.id))
    .limit(1000);
  return rows.map((r) => ({ ...r, name: maskName(decrypt(r.name)) }));
}

export async function purgeMode() {
  return (await getSettingString(SETTING_KEYS.PURGE_APPROVAL_MODE)) === 'Y' ? 'APPROVAL' : 'AUTO';
}

/** 파기 실행 (A-CUS-030 승인 또는 F-SYS-12 자동). 예정일이 지나지 않은 고객은 건너뛴다 */
export async function purgeCustomers(ids: number[], filter: BranchFilter, actor: { type: 'ADMIN' | 'SYSTEM'; id: number | null }, now = new Date()) {
  const db = getDb();
  const due = await db
    .select({ id: customer.id, customerNo: customer.customerNo, purgeDueDate: customer.purgeDueDate })
    .from(customer)
    .where(and(inArray(customer.id, ids), ne(customer.status, 'PURGED'), lte(customer.purgeDueDate, kstToday(now)), customerScopeCond(filter)));
  if (actor.type === 'ADMIN' && due.length === 0) throw new UserError('파기할 수 있는 고객이 없습니다. 파기 예정일을 확인해 주세요.');
  for (const c of due) {
    await db.transaction(async (tx) => {
      await tx
        .update(customer)
        .set({
          name: encrypt(PURGED_NAME)!,
          phone1: encrypt('-')!,
          phone1Hash: null,
          phone2: null,
          emergencyPhone: null,
          email: null,
          authProviderKey: null,
          referralCode: null,
          memo: null,
          marketingAgree: false,
          status: 'PURGED',
          updatedAt: now,
          updatedBy: actor.id,
        })
        .where(eq(customer.id, c.id));
      await tx.update(customerAddress).set({ detailAddress: null, alias: null, parkingNote: null, updatedAt: now, updatedBy: actor.id }).where(eq(customerAddress.customerId, c.id));
      await tx.update(callLog).set({ callerPhone: encrypt('-')!, callerPhoneHash: null, updatedAt: now }).where(eq(callLog.customerId, c.id));
      const orderIds = tx.select({ id: serviceOrder.id }).from(serviceOrder).where(eq(serviceOrder.customerId, c.id));
      const paymentIds = tx.select({ id: payment.id }).from(payment).where(inArray(payment.orderId, orderIds));
      await tx.update(taxDocument).set({ identityNo: null, updatedAt: now }).where(inArray(taxDocument.paymentId, paymentIds));
    });
    await writeAudit({
      actorType: actor.type,
      actorId: actor.id,
      action: 'DELETE',
      targetTable: 'customer',
      targetId: c.id,
      detail: { reason: 'PII_PURGE', customerNo: c.customerNo, purgeDueDate: c.purgeDueDate },
    });
  }
  return due.length;
}

/** F-SYS-12 매일 03:00: 승인 방식이면 대상 수만 세고, 자동 방식이면 바로 파기 */
export async function runPiiPurge(now = new Date()) {
  const targets = await listPurgeTargets({ kind: 'ALL' }, now);
  if ((await purgeMode()) === 'APPROVAL') return { mode: 'APPROVAL' as const, due: targets.length, purged: 0 };
  const purged = targets.length ? await purgeCustomers(targets.map((t) => t.id), { kind: 'ALL' }, { type: 'SYSTEM', id: null }, now) : 0;
  return { mode: 'AUTO' as const, due: targets.length, purged };
}

/* ---------- A-SYS-060 감사 로그 ---------- */

export interface AuditLogQuery {
  action: string | null;
  targetTable: string | null;
  actorKeyword: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

export async function listAuditLogs(q: AuditLogQuery) {
  const rows = await getDb()
    .select({ a: auditLog, actorName: adminUser.name, actorLogin: adminUser.loginId })
    .from(auditLog)
    .leftJoin(adminUser, and(eq(auditLog.actorType, 'ADMIN'), eq(adminUser.id, auditLog.actorId)))
    .where(
      and(
        q.action ? eq(auditLog.action, q.action) : undefined,
        q.targetTable ? eq(auditLog.targetTable, q.targetTable) : undefined,
        q.actorKeyword ? sql`(${adminUser.name} ilike ${`%${q.actorKeyword}%`} or ${adminUser.loginId} ilike ${`%${q.actorKeyword}%`})` : undefined,
        q.dateFrom ? gte(auditLog.createdAt, new Date(`${q.dateFrom}T00:00:00+09:00`)) : undefined,
        q.dateTo ? lte(auditLog.createdAt, new Date(`${q.dateTo}T23:59:59+09:00`)) : undefined,
      ),
    )
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(500);
  return rows.map((r) => ({
    id: r.a.id,
    createdAt: r.a.createdAt,
    actorType: r.a.actorType,
    actorName: r.actorName ?? (r.a.actorType === 'SYSTEM' ? '시스템' : r.a.actorId ? `#${r.a.actorId}` : '-'),
    actorLogin: r.actorLogin,
    action: r.a.action,
    targetTable: r.a.targetTable,
    targetId: r.a.targetId,
    ipAddress: r.a.ipAddress,
    detail: r.a.detailJson ? JSON.stringify(r.a.detailJson).slice(0, 300) : null,
  }));
}

/* ---------- F-SYS-11 일 집계 (02:00) ---------- */

/** 고객 최근 작업일·누적 주문 수·파기 예정일(ERD §6 = 탈퇴일 또는 최종 거래일(없으면 가입일) + PURGE_YEARS년, domain purgeDueDateOf 와 같은 식) */
export async function refreshCustomerAggregates() {
  const years = await getSettingNumber(SETTING_KEYS.PURGE_YEARS);
  const db = getDb();
  await db.execute(sql`
    update customer c set
      last_service_date = s.last_date,
      total_order_count = s.cnt
    from (
      select cu.id,
        (select max((o.completed_at at time zone 'Asia/Seoul')::date) from service_order o where o.customer_id = cu.id and o.status = 'COMPLETED' and o.deleted_at is null) as last_date,
        (select count(*)::int from service_order o where o.customer_id = cu.id and o.status <> 'CANCELED' and o.deleted_at is null) as cnt
      from customer cu where cu.status <> 'PURGED'
    ) s
    where c.id = s.id and (c.last_service_date is distinct from s.last_date or c.total_order_count is distinct from s.cnt)`);
  await db.execute(sql`
    update customer set purge_due_date = (
      case when status = 'WITHDRAWN' and withdrawn_at is not null then (withdrawn_at at time zone 'Asia/Seoul')::date
           else coalesce(last_service_date, (created_at at time zone 'Asia/Seoul')::date) end
      + make_interval(years => ${years}::int))::date
    where status <> 'PURGED'`);
}

export async function refreshTechVocCounts() {
  await getDb().execute(sql`update technician t set voc_count = s.n from (
      select te.id, (select count(*)::int from voc v where v.technician_id = te.id and v.voc_type = 'COMPLAINT') n from technician te
    ) s where t.id = s.id and t.voc_count <> s.n`);
}

/** F-SYS-11 배치 본체 */
export async function runDailyAggregate(now = new Date()) {
  await refreshCustomerAggregates();
  await refreshTechVocCounts();
  const asDone = await closeFinishedAs(now);
  const converted = await refreshCampaignConversions(now);
  return { asDone, converted };
}

/** 파기 대기 건수 (A-DSH-010 운영 현황 알림용) */
export async function purgeCandidateCount(filter: BranchFilter, now = new Date()) {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(customer)
    .where(and(isNull(customer.deletedAt), ne(customer.status, 'PURGED'), lte(customer.purgeDueDate, kstToday(now)), customerScopeCond(filter)));
  return r?.n ?? 0;
}
