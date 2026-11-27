import 'server-only';
/**
 * T-WRK-050 자재 사용 (단계 9, F-TEC-WRK-06, 01 §2.9.5 material_usage).
 * - 원가·판매가는 사용 시점 자재 마스터 값(스냅샷). 주기사만, 작업 중(도착~작업중)에만 입력
 * - 고객 청구 자재는 추가요금(MATERIAL, 금액 = 판매가 × 수량)을 함께 만들어 고객 동의를 받는다(BR-040). 증빙 사진은 받지 않는다
 * - 삭제: 연결된 추가요금이 응답 전이면 함께 철회, 이미 동의·거절됐으면 삭제 불가
 * - 자재원가 합계는 KPI 마진율(materialCostBetween)
 * - 단계 10: 사용 등록 시 기사 보유 자재(technician_material_stock)를 줄이고, 삭제하면 되돌린다(F-TEC-MAT-01)
 */
import { extraCharge, material, materialUsage, serviceOrder, workOrder } from '@aircon/db';
import { canWithdrawExtra, extraChargeState, checkMaterialUsage, materialChargeTitle, materialCostOf, materialSaleAmount } from '@aircon/domain';
import { and, asc, eq, gte, isNull, lt } from 'drizzle-orm';
import { UserError, ValidationFailed } from './action-result';
import { adjustTechStock } from './tech-support';
import { getDb } from './db';
import { addExtraCharge, withdrawExtraCharge } from './extra-charges';
import { mainOnly, workOf } from './work';

const EDITABLE_WORK = ['ARRIVED', 'IN_PROGRESS'];

/** 화면 데이터: 사용 가능한 자재 + 이 작업의 사용 내역 */
export async function getMaterialScreen(techId: number, orderNo: string) {
  const m = await mainOnly(techId, orderNo);
  const db = getDb();
  const w = await workOf(db, m.o.id);
  const [materials, rows] = await Promise.all([
    db
      .select({ id: material.id, code: material.materialCode, name: material.name, unit: material.unit, salePrice: material.salePrice })
      .from(material)
      .where(eq(material.isActive, true))
      .orderBy(asc(material.name)),
    w
      ? db
          .select({ u: materialUsage, name: material.name, unit: material.unit, charge: extraCharge })
          .from(materialUsage)
          .innerJoin(material, eq(material.id, materialUsage.materialId))
          .leftJoin(extraCharge, eq(extraCharge.id, materialUsage.extraChargeId))
          .where(eq(materialUsage.workOrderId, w.id))
          .orderBy(asc(materialUsage.id))
      : Promise.resolve([]),
  ]);
  return {
    orderNo,
    editable: Boolean(w && EDITABLE_WORK.includes(w.status)),
    materials,
    usages: rows.map((r) => ({
      id: r.u.id,
      name: r.name,
      unit: r.unit,
      quantity: r.u.quantity,
      chargeToCustomer: r.u.chargeToCustomer,
      saleAmount: r.u.saleAmount,
      chargeState: r.charge ? extraChargeState(r.charge) : null,
    })),
  };
}

/** F-TEC-WRK-06 자재 사용 등록 */
export async function addMaterialUsage(
  techId: number,
  v: { orderNo: string; materialId: number; quantity: number; chargeToCustomer: boolean },
  agreeUrl: (orderNo: string) => string,
  now = new Date(),
) {
  const m = await mainOnly(techId, v.orderNo);
  const db = getDb();
  const w = await workOf(db, m.o.id);
  if (!w || !EDITABLE_WORK.includes(w.status)) throw new UserError('도착 후 작업 중에만 자재를 입력할 수 있습니다.');
  const [mat] = await db.select().from(material).where(eq(material.id, v.materialId));
  const e = checkMaterialUsage({ materialFound: Boolean(mat), materialActive: mat?.isActive ?? false, quantity: v.quantity, chargeToCustomer: v.chargeToCustomer, salePrice: mat?.salePrice ?? 0 });
  if (Object.keys(e).length) throw new ValidationFailed(e);
  const saleAmount = materialSaleAmount(mat!.salePrice, v.quantity, v.chargeToCustomer);
  let chargeId: number | null = null;
  if (v.chargeToCustomer) {
    const c = await addExtraCharge(
      techId,
      { orderNo: v.orderNo, chargeType: 'MATERIAL', surchargeRuleId: null, baseOrderItemId: null, quantity: null, title: materialChargeTitle(mat!.name, v.quantity), amount: saleAmount, reason: '자재 사용' },
      null,
      agreeUrl,
      { fromMaterialMaster: true },
    );
    chargeId = c.id;
  }
  try {
    const [row] = await db
      .insert(materialUsage)
      .values({
        workOrderId: w.id,
        materialId: mat!.id,
        quantity: v.quantity,
        unitCost: mat!.unitCost,
        chargeToCustomer: v.chargeToCustomer,
        saleAmount,
        extraChargeId: chargeId,
        createdBy: techId,
        updatedBy: techId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: materialUsage.id });
    // 단계 10 F-TEC-MAT-01: 현장에서 쓴 만큼 보유 자재를 줄인다(0 아래로는 내려가지 않음)
    await adjustTechStock(db, techId, mat!.id, -v.quantity, now);
    return { id: row!.id, chargeId };
  } catch (err) {
    if (chargeId) await withdrawExtraCharge(techId, v.orderNo, chargeId).catch(() => undefined);
    throw err;
  }
}

/** 자재 사용 삭제 (응답 전 추가요금은 함께 철회) */
export async function removeMaterialUsage(techId: number, orderNo: string, usageId: number) {
  const m = await mainOnly(techId, orderNo);
  const db = getDb();
  const w = await workOf(db, m.o.id);
  if (!w || !EDITABLE_WORK.includes(w.status)) throw new UserError('작업 중에만 자재를 지울 수 있습니다.');
  const [u] = await db.select().from(materialUsage).where(and(eq(materialUsage.id, usageId), eq(materialUsage.workOrderId, w.id)));
  if (!u) throw new UserError('자재 사용 내역을 찾을 수 없습니다.');
  if (u.extraChargeId) {
    const [c] = await db.select().from(extraCharge).where(eq(extraCharge.id, u.extraChargeId));
    if (c && !c.deletedAt) {
      if (!canWithdrawExtra(c)) throw new UserError('고객이 이미 응답한 청구 자재는 지울 수 없습니다.');
      await withdrawExtraCharge(techId, orderNo, c.id);
    }
  }
  await db.delete(materialUsage).where(eq(materialUsage.id, u.id));
  await adjustTechStock(db, techId, u.materialId, u.quantity); // 단계 10: 사용 취소분을 보유 자재로 되돌림
}

/** KPI 마진율 자재원가: 기간 안 완료 주문의 Σ 원가 × 수량 (거점 선택 시 그 거점) */
export async function materialCostBetween(from: Date, to: Date, branchId: number | null) {
  const rows = await getDb()
    .select({ unitCost: materialUsage.unitCost, quantity: materialUsage.quantity })
    .from(materialUsage)
    .innerJoin(workOrder, eq(workOrder.id, materialUsage.workOrderId))
    .innerJoin(serviceOrder, eq(serviceOrder.id, workOrder.orderId))
    .where(
      and(
        eq(serviceOrder.status, 'COMPLETED'),
        gte(serviceOrder.completedAt, from),
        lt(serviceOrder.completedAt, to),
        branchId ? eq(serviceOrder.branchId, branchId) : undefined,
        isNull(serviceOrder.deletedAt),
      ),
    );
  return materialCostOf(rows);
}

