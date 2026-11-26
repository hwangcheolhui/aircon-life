import 'server-only';
/**
 * A-PRC-030 작업 결과 검수 (단계 9, F-ADM-PRC-03). 작업완료(DONE) 건의 사진·결과를 보고 승인 또는 반려(재작업 요청).
 * - 검수 상태 변경은 assertInspectionTransition(대기 → 승인/반려, 반려 → 승인)을 거친다. 반려 사유 필수
 * - 이미 정산에 들어간 작업은 바꿀 수 없다. 반려 건은 정산 대상에서 빠지고(settlements.targetJobs), INSPECTION_REQUIRED=Y 면 승인 건만 정산
 * - 반려하면 주기사에게 앱 알림(INSPECTION_REJECTED) — 재작업은 AS·재방문 흐름(A-VOC-030)으로 잡는다
 */
import type { inspectionInput, z } from '@aircon/contracts';
import { customer, serviceOrder, settlementItem, technician, workOrder, workPhoto, workResult } from '@aircon/db';
import { type BranchFilter, assertInspectionTransition, checkInspection, maskName } from '@aircon/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { UserError, ValidationFailed } from './action-result';
import { getDb } from './db';
import { notifyStaffWith } from './notify';
import type { Actor } from './orders';
import { decryptOrNull } from './pii';
import { assertInScope, scopeCond } from './voc';

export async function listInspections(filter: BranchFilter, q: { status: string | null; from: string | null; to: string | null }) {
  const db = getDb();
  const rows = await db
    .select({
      w: workOrder,
      orderNo: serviceOrder.orderNo,
      orderStatus: serviceOrder.status,
      branchId: serviceOrder.branchId,
      customerName: customer.name,
      techName: technician.name,
      inSettlement: sql<boolean>`exists (select 1 from settlement_item si where si.work_order_id = ${workOrder.id})`,
    })
    .from(workOrder)
    .innerJoin(serviceOrder, eq(serviceOrder.id, workOrder.orderId))
    .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
    .innerJoin(technician, eq(technician.id, workOrder.mainTechnicianId))
    .where(
      and(
        eq(workOrder.status, 'DONE'),
        scopeCond(filter, serviceOrder.branchId),
        q.status === 'WAITING' ? isNull(workOrder.inspectionStatus) : q.status ? eq(workOrder.inspectionStatus, q.status) : undefined,
        q.from ? gte(workOrder.finishedAt, new Date(`${q.from}T00:00:00+09:00`)) : undefined,
        q.to ? lte(workOrder.finishedAt, new Date(`${q.to}T23:59:59.999+09:00`)) : undefined,
      ),
    )
    .orderBy(desc(workOrder.finishedAt))
    .limit(300);
  const ids = rows.map((r) => r.w.id);
  const [photos, results] = ids.length
    ? await Promise.all([
        db.select().from(workPhoto).where(inArray(workPhoto.workOrderId, ids)).orderBy(asc(workPhoto.id)),
        db.select().from(workResult).where(inArray(workResult.workOrderId, ids)).orderBy(asc(workResult.id)),
      ])
    : [[], []];
  return rows.map((r) => ({
    workOrderId: r.w.id,
    orderNo: r.orderNo,
    orderStatus: r.orderStatus,
    customerName: maskName(decryptOrNull(r.customerName)),
    techName: r.techName,
    finishedAt: r.w.finishedAt,
    workMinutes: r.w.workMinutes,
    resultCode: r.w.resultCode,
    workNote: r.w.workNote,
    finalAmount: r.w.finalAmount,
    inspectionStatus: r.w.inspectionStatus ?? 'WAITING',
    inspectionNote: r.w.inspectionNote,
    inspectedAt: r.w.inspectedAt,
    inSettlement: Boolean(r.inSettlement),
    photos: photos.filter((p) => p.workOrderId === r.w.id).map((p) => ({ id: p.id, fileId: p.fileId, photoType: p.photoType, unitNo: p.unitNo })),
    results: results.filter((x) => x.workOrderId === r.w.id).map((x) => ({ unitNo: x.unitNo, result: x.result, conditionNote: x.conditionNote })),
  }));
}

/** F-ADM-PRC-03 승인·반려 */
export async function inspectWork(input: z.output<typeof inspectionInput>, filter: BranchFilter, actor: Actor, now = new Date()) {
  const db = getDb();
  const [row] = await db
    .select({ w: workOrder, orderNo: serviceOrder.orderNo, branchId: serviceOrder.branchId })
    .from(workOrder)
    .innerJoin(serviceOrder, eq(serviceOrder.id, workOrder.orderId))
    .where(eq(workOrder.id, input.workOrderId));
  if (!row) throw new UserError('작업을 찾을 수 없습니다.');
  assertInScope(filter, row.branchId);
  if (row.w.status !== 'DONE') throw new UserError('작업완료 건만 검수할 수 있습니다.');
  const inSettlement = (await db.select({ id: settlementItem.id }).from(settlementItem).where(eq(settlementItem.workOrderId, row.w.id)).limit(1)).length > 0;
  const e = checkInspection({ to: input.status, note: input.note ?? '', inSettlement });
  if (Object.keys(e).length) throw new ValidationFailed(e);
  assertInspectionTransition(row.w.inspectionStatus, input.status);
  const updated = await db
    .update(workOrder)
    .set({ inspectionStatus: input.status, inspectionNote: input.note, inspectedBy: actor.id, inspectedAt: now, updatedAt: now, updatedBy: actor.id })
    .where(
      and(
        eq(workOrder.id, row.w.id),
        row.w.inspectionStatus === null ? isNull(workOrder.inspectionStatus) : eq(workOrder.inspectionStatus, row.w.inspectionStatus),
      ),
    )
    .returning({ id: workOrder.id });
  if (!updated.length) throw new UserError('다른 곳에서 먼저 검수했습니다. 새로고침 후 확인해 주세요.');
  if (input.status === 'REJECTED')
    await notifyStaffWith(
      'INSPECTION_REJECTED',
      { type: 'TECHNICIAN', id: row.w.mainTechnicianId },
      { type: 'ORDER', id: row.w.orderId },
      { 접수번호: row.orderNo, 사유: input.note ?? '' },
      `/tech/jobs/${row.orderNo}`,
    );
}
