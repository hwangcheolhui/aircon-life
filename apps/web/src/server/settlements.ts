import 'server-only';
/**
 * 단계 7 정산 서버 서비스 (F-ADM-STL-01~04, F-TEC-STL-01·02, F-SYS-10, BR-080~084, 01 §2.11·§3.3).
 * - 상태 변경은 packages/domain settlement-rules 전이표를 거쳐 조건부 UPDATE 하고 settlement_status_history 에 1행 INSERT 한다.
 * - 정산 대상(BR-081): 기간 끝(일요일 24시, 한국 시간)까지 결제가 끝나 완료(COMPLETED)된 작업 중 아직 어느 정산 항목에도 없는 건.
 *   지난 회차에 빠진 작업(미수였다가 나중에 결제된 건 등)은 다음 회차가 자동으로 가져간다.
 * - settlement_item 은 INSERT ONLY. 관리자 조정은 항목을 더하고 정산서 합계를 다시 계산한다(확정 전까지만, BR-084는 DB 트리거로도 막는다).
 * - 현장 수금(BR-082): 정산에 들어간 주문에서 기사가 직접 받은 결제(payment.collected_by_tech_id) 합계를 상계한다.
 * - 거점 범위(BR-102): 거점 소속 관리자는 자기 거점 회차와 자기 거점 기사 정산서만 보고, 전체 회차는 본사만 처리한다.
 */
import {
  branch,
  commissionPolicy,
  orderItem,
  orderStatusHistory,
  payment,
  serviceOrder,
  settlement,
  settlementBatch,
  settlementItem,
  settlementStatusHistory,
  technician,
  workOrder,
  assignment,
} from '@aircon/db';
import {
  type BranchFilter,
  type CommissionPolicyLike,
  type FieldErrors,
  type ManualItemType,
  type SettlementBatchStatus,
  type SettlementStatus,
  SETTING_KEYS,
  assertBatchTransition,
  assertSettlementTransition,
  batchNoOf,
  calcJobShares,
  canAdjustSettlement,
  checkAdjustment,
  checkBatchConfirm,
  checkCommissionPolicy,
  checkDisputeResolve,
  checkTechResponse,
  isMonday,
  kstDate,
  manualItemAmount,
  previousWeek,
  scheduledPayDateOf,
  selectCommissionPolicy,
  splitTransferTargets,
  stlShiftDate,
  summarizeSettlement,
} from '@aircon/domain';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { UserError, ValidationFailed } from './action-result';
import { writeAudit } from './audit';
import { getDb } from './db';
import { notifyStaffWith } from './notify';
import type { Tx } from './orders';
import { decrypt } from './pii';
import { getSettingString } from './settings';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const fail = (e: FieldErrors) => {
  if (e.form) throw new UserError(e.form);
  if (Object.keys(e).length) throw new ValidationFailed(e);
};
const num = (v: string | null) => (v === null ? null : Number(v));

type Actor = { type: 'ADMIN' | 'TECHNICIAN' | 'SYSTEM'; id: number | null };
type BatchRow = typeof settlementBatch.$inferSelect;
type SettlementRow = typeof settlement.$inferSelect;

/** 기간 끝(일요일) 다음 날 0시(한국 시간) — 이 시각 전에 완료된 작업이 회차 대상 */
const periodEndExclusive = (periodEnd: string) => new Date(`${stlShiftDate(periodEnd, 1)}T00:00:00+09:00`);

/* ---------- 상태 전이 (01 §3.3) ---------- */

async function transitionBatch(
  tx: Tx,
  b: Pick<BatchRow, 'id' | 'status'>,
  to: SettlementBatchStatus,
  actor: Actor,
  opts: { memo?: string | null; set?: Partial<typeof settlementBatch.$inferInsert> } = {},
) {
  assertBatchTransition(b.status, to);
  const rows = await tx
    .update(settlementBatch)
    .set({ ...opts.set, status: to, updatedAt: new Date(), updatedBy: actor.id })
    .where(and(eq(settlementBatch.id, b.id), eq(settlementBatch.status, b.status)))
    .returning({ id: settlementBatch.id });
  if (!rows.length) throw new UserError('다른 곳에서 먼저 처리된 회차입니다. 새로고침 후 다시 확인해 주세요.');
  await tx.insert(settlementStatusHistory).values({
    batchId: b.id,
    settlementId: null,
    fromStatus: b.status,
    toStatus: to,
    actorType: actor.type,
    actorId: actor.id,
    memo: opts.memo ?? null,
  });
}

async function transitionSettlement(
  tx: Tx,
  s: Pick<SettlementRow, 'id' | 'batchId' | 'status'>,
  to: SettlementStatus,
  actor: Actor,
  opts: { memo?: string | null; set?: Partial<typeof settlement.$inferInsert> } = {},
) {
  assertSettlementTransition(s.status, to);
  const rows = await tx
    .update(settlement)
    .set({ ...opts.set, status: to, updatedAt: new Date(), updatedBy: actor.id })
    .where(and(eq(settlement.id, s.id), eq(settlement.status, s.status)))
    .returning({ id: settlement.id });
  if (!rows.length) throw new UserError('다른 곳에서 먼저 처리된 정산서입니다. 새로고침 후 다시 확인해 주세요.');
  await tx.insert(settlementStatusHistory).values({
    batchId: s.batchId,
    settlementId: s.id,
    fromStatus: s.status,
    toStatus: to,
    actorType: actor.type,
    actorId: actor.id,
    memo: opts.memo ?? null,
  });
}

/* ---------- 거점 범위 (BR-102) ---------- */

function batchScopeCond(filter: BranchFilter) {
  if (filter.kind === 'BRANCH')
    return sql`(${settlementBatch.branchId} IS NULL OR ${settlementBatch.branchId} = ${filter.branchId})`;
  if (filter.kind === 'NONE') return sql`false`;
  return undefined;
}
function techScopeCond(filter: BranchFilter) {
  if (filter.kind === 'BRANCH') return eq(technician.branchId, filter.branchId);
  if (filter.kind === 'NONE') return sql`false`;
  return undefined;
}

async function batchFor(id: number, filter: BranchFilter, opts: { write?: boolean } = {}): Promise<BatchRow> {
  const [b] = await getDb()
    .select()
    .from(settlementBatch)
    .where(and(eq(settlementBatch.id, id), batchScopeCond(filter)));
  if (!b) throw new UserError('정산 회차를 찾을 수 없거나 조회 권한이 없습니다.');
  // 전체 회차는 본사(전체 범위)만, 거점 회차는 그 거점 관리자도 처리한다
  if (opts.write && filter.kind !== 'ALL' && !(filter.kind === 'BRANCH' && b.branchId === filter.branchId))
    throw new UserError('전체 거점 회차는 본사 정산 담당자만 처리할 수 있습니다.');
  return b;
}

/* ---------- A-STL-010 수수료 정책 ---------- */

export type PolicyRow = typeof commissionPolicy.$inferSelect;

export async function listPolicies(filter: BranchFilter): Promise<PolicyRow[]> {
  const scope =
    filter.kind === 'BRANCH'
      ? sql`(${commissionPolicy.branchId} IS NULL OR ${commissionPolicy.branchId} = ${filter.branchId})`
      : filter.kind === 'NONE'
        ? sql`false`
        : undefined;
  return getDb()
    .select()
    .from(commissionPolicy)
    .where(and(isNull(commissionPolicy.deletedAt), scope))
    .orderBy(asc(commissionPolicy.branchId), asc(commissionPolicy.techGrade), desc(commissionPolicy.validFrom));
}

/** 정책 저장 전 검사: 계산 방식별 필수값(F-ADM-STL-01), 거점 소속 관리자는 자기 거점 정책만(BR-102) */
export function checkPolicyInput(
  v: {
    calcType: string;
    techShareRate: string | null;
    perUnitAmount: number | null;
    extraChargeShareRate: string | null;
    supportRoleRate: string | null;
    withholdingRate: string | null;
    branchId: number | null;
  },
  filter: BranchFilter,
) {
  fail(
    checkCommissionPolicy({
      calcType: v.calcType,
      techShareRate: num(v.techShareRate),
      perUnitAmount: v.perUnitAmount,
      extraChargeShareRate: num(v.extraChargeShareRate),
      supportRoleRate: num(v.supportRoleRate),
      withholdingRate: num(v.withholdingRate),
    }),
  );
  if (filter.kind === 'BRANCH' && v.branchId !== filter.branchId)
    throw new ValidationFailed({ branchId: '소속 거점의 정책만 등록할 수 있습니다.' });
  if (filter.kind === 'NONE') throw new UserError('소속 거점이 없어 정책을 저장할 수 없습니다.');
}

const policyLike = (p: PolicyRow): CommissionPolicyLike => ({
  id: p.id,
  policyName: p.policyName,
  techGrade: p.techGrade,
  contractType: p.contractType,
  branchId: p.branchId,
  calcType: p.calcType,
  techShareRate: num(p.techShareRate),
  perUnitAmount: p.perUnitAmount,
  extraChargeShareRate: num(p.extraChargeShareRate),
  supportRoleRate: num(p.supportRoleRate),
  withholdingRate: num(p.withholdingRate),
  validFrom: p.validFrom,
  validTo: p.validTo,
});

async function activePolicies(db: Tx | ReturnType<typeof getDb>) {
  return (await db.select().from(commissionPolicy).where(isNull(commissionPolicy.deletedAt))).map(policyLike);
}

/* ---------- A-STL-020 정산 회차 ---------- */

export interface BatchListRow {
  id: number;
  batchNo: string;
  periodStart: string;
  periodEnd: string;
  branchName: string | null;
  status: string;
  scheduledPayDate: string | null;
  confirmedAt: Date | null;
  techCount: number;
  disputedCount: number;
  pendingCount: number;
  totalNetPay: number;
}

export async function listBatches(filter: BranchFilter): Promise<BatchListRow[]> {
  const db = getDb();
  const batches = await db
    .select({ b: settlementBatch, branchName: branch.name })
    .from(settlementBatch)
    .leftJoin(branch, eq(branch.id, settlementBatch.branchId))
    .where(batchScopeCond(filter))
    .orderBy(desc(settlementBatch.periodStart), asc(settlementBatch.batchNo))
    .limit(100);
  if (!batches.length) return [];
  const stats = await db
    .select({
      batchId: settlement.batchId,
      techCount: sql<number>`count(*)::int`,
      disputed: sql<number>`count(*) FILTER (WHERE ${settlement.status} = 'DISPUTED')::int`,
      pending: sql<number>`count(*) FILTER (WHERE ${settlement.status} = 'CALCULATED')::int`,
      net: sql<number>`coalesce(sum(${settlement.netPay}), 0)::int`,
    })
    .from(settlement)
    .innerJoin(technician, eq(technician.id, settlement.technicianId))
    .where(and(inArray(settlement.batchId, batches.map((x) => x.b.id)), techScopeCond(filter)))
    .groupBy(settlement.batchId);
  const byId = new Map(stats.map((s) => [s.batchId, s]));
  return batches.map(({ b, branchName }) => {
    const s = byId.get(b.id);
    return {
      id: b.id,
      batchNo: b.batchNo,
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
      branchName,
      status: b.status,
      scheduledPayDate: b.scheduledPayDate,
      confirmedAt: b.confirmedAt,
      techCount: s?.techCount ?? 0,
      disputedCount: s?.disputed ?? 0,
      pendingCount: s?.pending ?? 0,
      totalNetPay: s?.net ?? 0,
    };
  });
}

/** F-ADM-STL-02 [회차 생성]: 기간(월~일, 끝난 주만)·거점 → DRAFT */
export async function createBatch(
  input: { periodStart: string; branchId: number | null },
  filter: BranchFilter,
  actor: Actor,
  now = new Date(),
): Promise<{ id: number; batchNo: string }> {
  if (!isMonday(input.periodStart)) throw new ValidationFailed({ periodStart: '정산 기간은 월요일부터 시작합니다(월~일 집계).' });
  const periodEnd = stlShiftDate(input.periodStart, 6);
  if (periodEnd >= kstDate(now)) throw new ValidationFailed({ periodStart: '끝난 주(일요일까지 지난 주)만 정산할 수 있습니다.' });
  let branchId = input.branchId;
  if (filter.kind === 'BRANCH') branchId = filter.branchId;
  if (filter.kind === 'NONE') throw new UserError('소속 거점이 없어 회차를 만들 수 없습니다.');
  const db = getDb();
  let branchCode: string | null = null;
  if (branchId) {
    const [b] = await db.select({ code: branch.branchCode }).from(branch).where(eq(branch.id, branchId));
    if (!b) throw new ValidationFailed({ branchId: '거점을 찾을 수 없습니다.' });
    branchCode = b.code;
  }
  const batchNo = batchNoOf(input.periodStart, branchCode);
  const weekday = await getSettingString(SETTING_KEYS.SETTLEMENT_WEEKDAY).catch(() => 'WED');
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: settlementBatch.id }).from(settlementBatch).where(eq(settlementBatch.batchNo, batchNo));
    if (dup) throw new UserError(`이미 만든 회차입니다(${batchNo}).`);
    const [b] = await tx
      .insert(settlementBatch)
      .values({
        batchNo,
        periodStart: input.periodStart,
        periodEnd,
        branchId,
        status: 'DRAFT',
        scheduledPayDate: scheduledPayDateOf(periodEnd, weekday),
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning({ id: settlementBatch.id });
    await tx.insert(settlementStatusHistory).values({
      batchId: b!.id,
      fromStatus: null,
      toStatus: 'DRAFT',
      actorType: actor.type,
      actorId: actor.id,
      memo: null,
    });
    return { id: b!.id, batchNo };
  });
}

interface TargetJob {
  workOrderId: number;
  orderId: number;
  orderNo: string;
  mainTechnicianId: number;
  totalAmount: number;
  extraAmount: number;
}

/** BR-081 정산 대상 작업: 기간 끝까지 결제 완료(COMPLETED)되었고 아직 정산 항목이 없는 작업 */
async function targetJobs(tx: Tx, b: BatchRow): Promise<TargetJob[]> {
  // 단계 9 작업 결과 검수(F-ADM-PRC-03): 반려 건은 정산 제외, INSPECTION_REQUIRED=Y 면 승인 건만
  const inspectionRequired = (await getSettingString(SETTING_KEYS.INSPECTION_REQUIRED)) === 'Y';
  const completedAt = sql`(SELECT max(h.created_at) FROM ${orderStatusHistory} h WHERE h.order_id = ${serviceOrder.id} AND h.to_status = 'COMPLETED')`;
  return tx
    .select({
      workOrderId: workOrder.id,
      orderId: serviceOrder.id,
      orderNo: serviceOrder.orderNo,
      mainTechnicianId: workOrder.mainTechnicianId,
      totalAmount: serviceOrder.totalAmount,
      extraAmount: serviceOrder.extraAmount,
    })
    .from(workOrder)
    .innerJoin(serviceOrder, eq(serviceOrder.id, workOrder.orderId))
    .where(
      and(
        eq(workOrder.status, 'DONE'),
        eq(workOrder.isSettlementTarget, true),
        eq(serviceOrder.status, 'COMPLETED'),
        inspectionRequired
          ? eq(workOrder.inspectionStatus, 'APPROVED')
          : sql`(${workOrder.inspectionStatus} IS NULL OR ${workOrder.inspectionStatus} <> 'REJECTED')`,
        b.branchId ? eq(serviceOrder.branchId, b.branchId) : undefined,
        sql`${completedAt} < ${periodEndExclusive(b.periodEnd).toISOString()}::timestamptz`,
        sql`NOT EXISTS (SELECT 1 FROM ${settlementItem} si WHERE si.work_order_id = ${workOrder.id})`,
      ),
    )
    .orderBy(asc(serviceOrder.completedAt), asc(workOrder.id));
}

type TechInfo = { id: number; name: string; grade: string; contractType: string; branchId: number };

async function techInfos(tx: Tx, ids: number[]): Promise<Map<number, TechInfo>> {
  if (!ids.length) return new Map();
  const rows = await tx
    .select({ id: technician.id, name: technician.name, grade: technician.grade, contractType: technician.contractType, branchId: technician.branchId })
    .from(technician)
    .where(inArray(technician.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

function policyFor(policies: CommissionPolicyLike[], t: TechInfo, date: string): CommissionPolicyLike {
  const p = selectCommissionPolicy(policies, t, date);
  if (!p) throw new UserError(`${t.name} 기사에게 적용할 수수료 정책이 없습니다. 수수료 정책(A-STL-010)을 먼저 등록해 주세요.`);
  return p;
}

/** 정산서 합계를 항목에서 다시 계산해 저장 (확정 전만) */
async function recalcSettlement(tx: Tx, settlementId: number, cashCollected: number, t: TechInfo, policy: CommissionPolicyLike, actorId: number | null) {
  const items = await tx
    .select({
      itemType: settlementItem.itemType,
      role: settlementItem.role,
      workOrderId: settlementItem.workOrderId,
      salesAmount: settlementItem.salesAmount,
      payAmount: settlementItem.payAmount,
    })
    .from(settlementItem)
    .where(eq(settlementItem.settlementId, settlementId));
  const totals = summarizeSettlement(items, { cashCollected, contractType: t.contractType, withholdingRate: policy.withholdingRate });
  await tx
    .update(settlement)
    .set({ ...totals, updatedAt: new Date(), updatedBy: actorId })
    .where(eq(settlement.id, settlementId));
  return totals;
}

async function refreshBatchTotal(tx: Tx, batchId: number, actorId: number | null) {
  const [s] = await tx
    .select({ total: sql<number>`coalesce(sum(${settlement.netPay}), 0)::int` })
    .from(settlement)
    .where(eq(settlement.batchId, batchId));
  await tx
    .update(settlementBatch)
    .set({ totalPayAmount: s?.total ?? 0, updatedAt: new Date(), updatedBy: actorId })
    .where(eq(settlementBatch.id, batchId));
}

/**
 * F-ADM-STL-02 [계산] (F-SYS-10 배치도 같은 함수): DRAFT → CALCULATED.
 * 대상 작업마다 주기사 정책으로 배분(2인 작업 지원율·추가요금 배분율·교육 동행 0원) → 기사별 정산서·항목 → 현장 수금 상계·원천세.
 * 기사에게 "정산 확인 요청" 푸시.
 */
export async function calculateBatch(batchId: number, filter: BranchFilter, actor: Actor) {
  const b = await batchFor(batchId, filter, { write: true });
  if (b.status !== 'DRAFT') throw new UserError('작성 상태 회차만 계산할 수 있습니다.');
  const result = await getDb().transaction(async (tx) => {
    // 같은 작업이 두 회차에 동시에 들어가지 않게 정산 계산을 한 번에 하나씩
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('settlement-calc'))`);
    const jobs = await targetJobs(tx, b);
    const orderIds = jobs.map((j) => j.orderId);
    const helpers = orderIds.length
      ? await tx
          .select({ orderId: assignment.orderId, technicianId: assignment.technicianId, role: assignment.role })
          .from(assignment)
          .where(and(inArray(assignment.orderId, orderIds), inArray(assignment.role, ['SUPPORT', 'ACCOMPANY']), eq(assignment.status, 'ACCEPTED')))
      : [];
    const units = orderIds.length
      ? await tx
          .select({ orderId: orderItem.orderId, units: sql<number>`coalesce(sum(${orderItem.quantity}), 0)::int` })
          .from(orderItem)
          .where(and(inArray(orderItem.orderId, orderIds), eq(orderItem.itemType, 'PRODUCT'), sql`${orderItem.itemStatus} <> 'SKIPPED'`))
          .groupBy(orderItem.orderId)
      : [];
    const cash = orderIds.length
      ? await tx
          .select({ orderId: payment.orderId, techId: payment.collectedByTechId, amount: sql<number>`coalesce(sum(${payment.amount}), 0)::int` })
          .from(payment)
          .where(and(inArray(payment.orderId, orderIds), eq(payment.status, 'APPROVED'), sql`${payment.collectedByTechId} IS NOT NULL`))
          .groupBy(payment.orderId, payment.collectedByTechId)
      : [];
    const unitsOf = new Map(units.map((u) => [u.orderId, u.units]));
    const techIds = new Set<number>(jobs.map((j) => j.mainTechnicianId));
    for (const h of helpers) if (h.technicianId) techIds.add(h.technicianId);
    for (const c of cash) if (c.techId) techIds.add(c.techId);
    const techs = await techInfos(tx, [...techIds]);
    const policies = await activePolicies(tx);

    // 기사별 항목 모으기
    const perTech = new Map<number, { items: (typeof settlementItem.$inferInsert)[]; cash: number }>();
    const bucket = (id: number) => {
      let x = perTech.get(id);
      if (!x) perTech.set(id, (x = { items: [], cash: 0 }));
      return x;
    };
    for (const j of jobs) {
      const main = techs.get(j.mainTechnicianId)!;
      const policy = policyFor(policies, main, b.periodEnd);
      const shares = calcJobShares(
        {
          totalAmount: j.totalAmount,
          extraAmount: j.extraAmount,
          units: unitsOf.get(j.orderId) ?? 0,
          mainTechnicianId: j.mainTechnicianId,
          supportTechnicianIds: helpers.filter((h) => h.orderId === j.orderId && h.role === 'SUPPORT' && h.technicianId).map((h) => h.technicianId!),
          accompanyTechnicianIds: helpers.filter((h) => h.orderId === j.orderId && h.role === 'ACCOMPANY' && h.technicianId).map((h) => h.technicianId!),
        },
        policy,
      );
      for (const s of shares) {
        bucket(s.technicianId).items.push({
          settlementId: 0,
          workOrderId: j.workOrderId,
          orderId: j.orderId,
          role: s.role,
          salesAmount: s.salesAmount,
          shareRate: s.shareRate === null ? null : s.shareRate.toFixed(2),
          payAmount: s.payAmount,
          itemType: s.itemType,
          memo: [policy.policyName, s.memo].filter(Boolean).join(' · ').slice(0, 300),
          createdBy: actor.id,
          updatedBy: actor.id,
        });
      }
      for (const c of cash.filter((x) => x.orderId === j.orderId)) bucket(c.techId ?? j.mainTechnicianId).cash += c.amount;
    }

    let total = 0;
    const created: { settlementId: number; technicianId: number; netPay: number }[] = [];
    for (const [techId, x] of perTech) {
      const t = techs.get(techId)!;
      const policy = policyFor(policies, t, b.periodEnd);
      const [s] = await tx
        .insert(settlement)
        .values({
          batchId: b.id,
          technicianId: techId,
          jobCount: 0,
          grossSales: 0,
          basePay: 0,
          taxableAmount: 0,
          netPay: 0,
          status: 'CALCULATED',
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning({ id: settlement.id });
      if (x.items.length) await tx.insert(settlementItem).values(x.items.map((i) => ({ ...i, settlementId: s!.id })));
      const totals = await recalcSettlement(tx, s!.id, x.cash, t, policy, actor.id);
      await tx.insert(settlementStatusHistory).values({
        batchId: b.id,
        settlementId: s!.id,
        fromStatus: null,
        toStatus: 'CALCULATED',
        actorType: actor.type,
        actorId: actor.id,
        memo: null,
      });
      total += totals.netPay;
      created.push({ settlementId: s!.id, technicianId: techId, netPay: totals.netPay });
    }
    await transitionBatch(tx, b, 'CALCULATED', actor, {
      memo: `작업 ${jobs.length}건 · 기사 ${created.length}명`,
      set: { totalPayAmount: total },
    });
    return { jobCount: jobs.length, techCount: created.length, created };
  });
  for (const c of result.created) {
    await notifyStaffWith(
      'STL_CONFIRM_REQUEST',
      { type: 'TECHNICIAN', id: c.technicianId },
      { type: 'SETTLEMENT', id: c.settlementId },
      { 정산회차: b.batchNo, 실지급액: won(c.netPay) },
      `/tech/settlements/${c.settlementId}`,
    );
  }
  return { jobCount: result.jobCount, techCount: result.techCount };
}

/** F-ADM-STL-04 [확정]: 이의가 없으면 회차와 정산서를 확정(BR-084 이후 수정 불가) */
export async function confirmBatch(batchId: number, filter: BranchFilter, actor: Actor) {
  const b = await batchFor(batchId, filter, { write: true });
  await getDb().transaction(async (tx) => {
    const rows = await tx.select().from(settlement).where(eq(settlement.batchId, b.id));
    const err = checkBatchConfirm(b.status, rows.map((r) => r.status));
    if (err) throw new UserError(err);
    for (const s of rows) {
      if (s.status === 'CONFIRMED') continue;
      await transitionSettlement(tx, s, 'CONFIRMED', actor, { memo: s.status === 'CALCULATED' ? '기사 미응답 상태로 회차 확정' : null });
    }
    await transitionBatch(tx, b, 'CONFIRMED', actor, { set: { confirmedBy: actor.id, confirmedAt: new Date() } });
  });
}

export interface TransferRow {
  techCode: string;
  techName: string;
  bankCode: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  netPay: number;
}

/** F-ADM-STL-04 [지급 파일]: 은행 대량이체 파일(계좌 원문 포함 → 감사 로그 EXPORT, BR-100) */
export async function transferFile(batchId: number, filter: BranchFilter, adminId: number) {
  const b = await batchFor(batchId, filter, { write: true });
  if (b.status !== 'CONFIRMED' && b.status !== 'PAID') throw new UserError('확정된 회차만 지급 파일을 받을 수 있습니다.');
  const rows = await getDb()
    .select({
      techCode: technician.techCode,
      techName: technician.name,
      bankCode: technician.bankCode,
      bankAccount: technician.bankAccount,
      accountHolder: technician.accountHolder,
      netPay: settlement.netPay,
    })
    .from(settlement)
    .innerJoin(technician, eq(technician.id, settlement.technicianId))
    .where(eq(settlement.batchId, b.id))
    .orderBy(asc(technician.techCode));
  const plain: TransferRow[] = rows.map((r) => ({ ...r, bankAccount: decrypt(r.bankAccount) }));
  const split = splitTransferTargets(plain);
  await writeAudit({
    actorId: adminId,
    action: 'EXPORT',
    targetTable: 'settlement_batch',
    targetId: b.id,
    detail: { batchNo: b.batchNo, kind: 'TRANSFER_FILE', count: split.transfers.length },
  });
  return { batch: b, ...split };
}

/** 지급 파일 전에 보여 줄 요약 (계좌 없는 기사·이체 없는 기사) — 계좌 원문은 다루지 않는다 */
export async function transferSummary(batchId: number, filter: BranchFilter) {
  const b = await batchFor(batchId, filter);
  const rows = await getDb()
    .select({
      techCode: technician.techCode,
      techName: technician.name,
      bankCode: technician.bankCode,
      bankAccount: sql<string | null>`CASE WHEN ${technician.bankAccount} IS NULL THEN NULL ELSE 'Y' END`,
      accountHolder: technician.accountHolder,
      netPay: settlement.netPay,
    })
    .from(settlement)
    .innerJoin(technician, eq(technician.id, settlement.technicianId))
    .where(eq(settlement.batchId, b.id));
  const s = splitTransferTargets(rows);
  return {
    transferCount: s.transfers.length,
    transferTotal: s.transfers.reduce((n, r) => n + r.netPay, 0),
    missingAccount: s.missingAccount.map((r) => r.techName),
    nonPositive: s.nonPositive.map((r) => r.techName),
  };
}

/** F-ADM-STL-04 [지급 완료]: CONFIRMED → PAID, 기사 알림 */
export async function markBatchPaid(batchId: number, transferRef: string | null, filter: BranchFilter, actor: Actor) {
  const b = await batchFor(batchId, filter, { write: true });
  if (b.status !== 'CONFIRMED') throw new UserError('확정된 회차만 지급 완료로 바꿀 수 있습니다.');
  const now = new Date();
  const paid = await getDb().transaction(async (tx) => {
    const rows = await tx.select().from(settlement).where(eq(settlement.batchId, b.id));
    for (const s of rows) {
      await transitionSettlement(tx, s, 'PAID', actor, {
        memo: s.netPay > 0 ? null : '실지급액 0원 이하(이체 없음)',
        set: { paidAt: now, transferRef },
      });
    }
    await transitionBatch(tx, b, 'PAID', actor, { memo: transferRef ? `이체 참조 ${transferRef}` : null });
    return rows;
  });
  for (const s of paid) {
    if (s.netPay <= 0) continue;
    await notifyStaffWith(
      'STL_PAID',
      { type: 'TECHNICIAN', id: s.technicianId },
      { type: 'SETTLEMENT', id: s.id },
      { 정산회차: b.batchNo, 실지급액: won(s.netPay) },
      `/tech/settlements/${s.id}`,
    );
  }
}

/** [마감]: PAID → CLOSED */
export async function closeBatch(batchId: number, filter: BranchFilter, actor: Actor) {
  const b = await batchFor(batchId, filter, { write: true });
  await getDb().transaction((tx) => transitionBatch(tx, b, 'CLOSED', actor));
}

/* ---------- A-STL-030 기사별 정산 검토·조정 ---------- */

export interface SettlementListRow {
  id: number;
  technicianId: number;
  techCode: string;
  techName: string;
  grade: string;
  contractType: string;
  jobCount: number;
  grossSales: number;
  basePay: number;
  extraPay: number;
  incentive: number;
  deduction: number;
  cashCollected: number;
  taxableAmount: number;
  withholdingTax: number;
  netPay: number;
  status: string;
}

export async function listSettlements(batchId: number, filter: BranchFilter): Promise<{ batch: BatchRow; rows: SettlementListRow[] }> {
  const b = await batchFor(batchId, filter);
  const rows = await getDb()
    .select({
      id: settlement.id,
      technicianId: settlement.technicianId,
      techCode: technician.techCode,
      techName: technician.name,
      grade: technician.grade,
      contractType: technician.contractType,
      jobCount: settlement.jobCount,
      grossSales: settlement.grossSales,
      basePay: settlement.basePay,
      extraPay: settlement.extraPay,
      incentive: settlement.incentive,
      deduction: settlement.deduction,
      cashCollected: settlement.cashCollected,
      taxableAmount: settlement.taxableAmount,
      withholdingTax: settlement.withholdingTax,
      netPay: settlement.netPay,
      status: settlement.status,
    })
    .from(settlement)
    .innerJoin(technician, eq(technician.id, settlement.technicianId))
    .where(and(eq(settlement.batchId, b.id), techScopeCond(filter)))
    .orderBy(asc(technician.techCode));
  return { batch: b, rows };
}

export interface SettlementItemRow {
  id: number;
  itemType: string;
  role: string | null;
  orderNo: string | null;
  salesAmount: number;
  shareRate: string | null;
  payAmount: number;
  memo: string | null;
  createdAt: Date;
}

export interface SettlementHistoryRow {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  actorType: string;
  memo: string | null;
  createdAt: Date;
}

async function detailOf(s: SettlementRow) {
  const db = getDb();
  const [items, history] = await Promise.all([
    db
      .select({
        id: settlementItem.id,
        itemType: settlementItem.itemType,
        role: settlementItem.role,
        orderNo: serviceOrder.orderNo,
        salesAmount: settlementItem.salesAmount,
        shareRate: settlementItem.shareRate,
        payAmount: settlementItem.payAmount,
        memo: settlementItem.memo,
        createdAt: settlementItem.createdAt,
      })
      .from(settlementItem)
      .leftJoin(serviceOrder, eq(serviceOrder.id, settlementItem.orderId))
      .where(eq(settlementItem.settlementId, s.id))
      .orderBy(asc(settlementItem.id)),
    db
      .select({
        id: settlementStatusHistory.id,
        fromStatus: settlementStatusHistory.fromStatus,
        toStatus: settlementStatusHistory.toStatus,
        actorType: settlementStatusHistory.actorType,
        memo: settlementStatusHistory.memo,
        createdAt: settlementStatusHistory.createdAt,
      })
      .from(settlementStatusHistory)
      .where(eq(settlementStatusHistory.settlementId, s.id))
      .orderBy(asc(settlementStatusHistory.id)),
  ]);
  return { items: items as SettlementItemRow[], history: history as SettlementHistoryRow[] };
}

export async function getSettlementDetail(id: number, filter: BranchFilter) {
  const [row] = await getDb()
    .select({ s: settlement, techName: technician.name, techCode: technician.techCode, contractType: technician.contractType })
    .from(settlement)
    .innerJoin(technician, eq(technician.id, settlement.technicianId))
    .where(and(eq(settlement.id, id), techScopeCond(filter)));
  if (!row) throw new UserError('정산서를 찾을 수 없거나 조회 권한이 없습니다.');
  const b = await batchFor(row.s.batchId, filter);
  return {
    settlement: row.s,
    techName: row.techName,
    techCode: row.techCode,
    contractType: row.contractType,
    batch: b,
    canAdjust: canAdjustSettlement(b.status, row.s.status),
    ...(await detailOf(row.s)),
  };
}

/**
 * F-ADM-STL-03 조정 추가 (인센티브·공제·조정, 사유 필수). 계산된 회차에서 기사 미확인·이의 정산서에만.
 * 그 기사의 정산서가 이 회차에 없으면 새로 만든다(전 회차 조정만 있는 기사, BR-084).
 */
export async function addAdjustment(
  input: { batchId: number; technicianId: number; itemType: ManualItemType; amount: number; memo: string },
  filter: BranchFilter,
  actor: Actor,
) {
  fail(checkAdjustment(input));
  const b = await batchFor(input.batchId, filter, { write: true });
  return getDb().transaction(async (tx) => {
    const t = (await techInfos(tx, [input.technicianId])).get(input.technicianId);
    if (!t || (filter.kind === 'BRANCH' && t.branchId !== filter.branchId)) throw new UserError('기사를 찾을 수 없거나 조회 권한이 없습니다.');
    const [existing] = await tx
      .select()
      .from(settlement)
      .where(and(eq(settlement.batchId, b.id), eq(settlement.technicianId, t.id)));
    if (!canAdjustSettlement(b.status, existing?.status ?? null))
      throw new UserError(
        existing && existing.status === 'TECH_CONFIRMED'
          ? '기사가 이미 확인한 정산서입니다. 다음 회차에서 조정 항목으로 처리하세요.'
          : '확정된 정산은 수정할 수 없습니다. 다음 회차에서 조정 항목으로 처리하세요.',
      );
    const policy = policyFor(await activePolicies(tx), t, b.periodEnd);
    let s = existing;
    if (!s) {
      [s] = await tx
        .insert(settlement)
        .values({
          batchId: b.id,
          technicianId: t.id,
          jobCount: 0,
          grossSales: 0,
          basePay: 0,
          taxableAmount: 0,
          netPay: 0,
          status: 'CALCULATED',
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning();
      await tx.insert(settlementStatusHistory).values({
        batchId: b.id,
        settlementId: s!.id,
        fromStatus: null,
        toStatus: 'CALCULATED',
        actorType: actor.type,
        actorId: actor.id,
        memo: '조정 항목으로 정산서 추가',
      });
    }
    await tx.insert(settlementItem).values({
      settlementId: s!.id,
      itemType: input.itemType,
      payAmount: manualItemAmount(input.itemType, input.amount),
      salesAmount: 0,
      memo: input.memo.trim().slice(0, 300),
      createdBy: actor.id,
      updatedBy: actor.id,
    });
    await recalcSettlement(tx, s!.id, s!.cashCollected, t, policy, actor.id);
    await refreshBatchTotal(tx, b.id, actor.id);
    return { settlementId: s!.id };
  });
}

/** F-ADM-STL-03 이의 처리: DISPUTED → CONFIRMED (처리 내용 필수, 필요한 조정은 먼저 [조정 추가]) */
export async function resolveDispute(settlementId: number, note: string, filter: BranchFilter, actor: Actor) {
  const d = await getSettlementDetail(settlementId, filter);
  await batchFor(d.batch.id, filter, { write: true });
  fail(checkDisputeResolve({ status: d.settlement.status, note }));
  if (d.batch.status !== 'CALCULATED') throw new UserError('계산 완료 상태 회차의 이의만 처리할 수 있습니다.');
  await getDb().transaction((tx) => transitionSettlement(tx, d.settlement, 'CONFIRMED', actor, { memo: `이의 처리: ${note.trim()}`.slice(0, 500) }));
}

/** 조정 창의 기사 선택지 (거점 범위) */
export async function adjustableTechs(filter: BranchFilter) {
  return getDb()
    .select({ id: technician.id, name: technician.name, techCode: technician.techCode })
    .from(technician)
    .where(and(isNull(technician.deletedAt), techScopeCond(filter)))
    .orderBy(asc(technician.techCode));
}

/* ---------- 기사 앱 T-STL-010·020 ---------- */

export interface TechSettlementCard {
  id: number;
  batchNo: string;
  periodStart: string;
  periodEnd: string;
  scheduledPayDate: string | null;
  jobCount: number;
  netPay: number;
  status: string;
  paidAt: Date | null;
}

/** F-TEC-STL-01 회차별 정산 (계산된 회차부터) */
export async function listTechSettlements(techId: number): Promise<TechSettlementCard[]> {
  return getDb()
    .select({
      id: settlement.id,
      batchNo: settlementBatch.batchNo,
      periodStart: settlementBatch.periodStart,
      periodEnd: settlementBatch.periodEnd,
      scheduledPayDate: settlementBatch.scheduledPayDate,
      jobCount: settlement.jobCount,
      netPay: settlement.netPay,
      status: settlement.status,
      paidAt: settlement.paidAt,
    })
    .from(settlement)
    .innerJoin(settlementBatch, eq(settlementBatch.id, settlement.batchId))
    .where(and(eq(settlement.technicianId, techId), sql`${settlementBatch.status} <> 'DRAFT'`))
    .orderBy(desc(settlementBatch.periodStart), desc(settlement.id))
    .limit(60);
}

export async function getTechSettlement(techId: number, id: number) {
  const [row] = await getDb()
    .select({ s: settlement, b: settlementBatch })
    .from(settlement)
    .innerJoin(settlementBatch, eq(settlementBatch.id, settlement.batchId))
    .where(and(eq(settlement.id, id), eq(settlement.technicianId, techId), sql`${settlementBatch.status} <> 'DRAFT'`));
  if (!row) return null;
  return { settlement: row.s, batch: row.b, ...(await detailOf(row.s)) };
}

/** F-TEC-STL-02 [확인] / [이의 제기(사유)] */
export async function techRespond(techId: number, id: number, action: 'CONFIRM' | 'DISPUTE', note: string) {
  const d = await getTechSettlement(techId, id);
  if (!d) throw new UserError('정산서를 찾을 수 없습니다.');
  fail(checkTechResponse({ status: d.settlement.status, action, note }));
  if (d.batch.status !== 'CALCULATED') throw new UserError('이미 확정된 정산입니다.');
  const actor: Actor = { type: 'TECHNICIAN', id: techId };
  await getDb().transaction((tx) =>
    action === 'CONFIRM'
      ? transitionSettlement(tx, d.settlement, 'TECH_CONFIRMED', actor)
      : transitionSettlement(tx, d.settlement, 'DISPUTED', actor, {
          memo: note.trim().slice(0, 500),
          set: { disputeNote: note.trim().slice(0, 500) },
        }),
  );
  if (action === 'DISPUTE') {
    const [t] = await getDb().select({ name: technician.name }).from(technician).where(eq(technician.id, techId));
    await notifyStaffWith(
      'STL_DISPUTED',
      { type: 'ADMIN', id: null },
      { type: 'SETTLEMENT', id },
      { 기사명: t?.name ?? '', 정산회차: d.batch.batchNo },
      `/admin/stl/settlements?batchId=${d.batch.id}&id=${id}`,
    );
  }
}

/* ---------- F-SYS-10 정산 회차 자동 생성 ---------- */

/** 매주 월요일: 전주(월~일) 전체 회차를 DRAFT로 만들고 바로 계산한다. 이미 있으면 건너뛴다 */
export async function autoCreateWeeklyBatch(now = new Date()) {
  const { periodStart } = previousWeek(kstDate(now));
  const batchNo = batchNoOf(periodStart);
  const [dup] = await getDb().select({ id: settlementBatch.id, status: settlementBatch.status }).from(settlementBatch).where(eq(settlementBatch.batchNo, batchNo));
  const actor: Actor = { type: 'SYSTEM', id: null };
  const all: BranchFilter = { kind: 'ALL' };
  const id = dup ? dup.id : (await createBatch({ periodStart, branchId: null }, all, actor, now)).id;
  if (dup && dup.status !== 'DRAFT') return { batchNo, created: false, calculated: false };
  const r = await calculateBatch(id, all, actor);
  return { batchNo, created: !dup, calculated: true, ...r };
}
