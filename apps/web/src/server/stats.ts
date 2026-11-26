import 'server-only';
/**
 * 통계 (단계 9): 운영 A-STA-020(F-ADM-STA-02) · 기사 성과 A-STA-030(F-ADM-STA-03, BR-051) · 고객·CRM A-STA-040(F-ADM-STA-04).
 * 산출식은 packages/domain stats-rules. 거점 범위(BR-102)는 주문 거점(기사 성과는 기사 소속 거점).
 * 기간은 한국 날짜 [from, to] (to 포함).
 */
import { asRequest, campaign, campaignTarget, customer, customerAddress, orderItem, orderStatusHistory, review, serviceOrder, serviceProduct, technician, timeSlot, voc, workOrder } from '@aircon/db';
import { type BranchFilter, avgWorkMinutesByType, distribution, newVsRepeat, opsRates, pctOf, techPerformance } from '@aircon/domain';
import { and, eq, gte, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { branchCond } from './admin-orders';
import { getDb } from './db';

const kstStart = (d: string) => new Date(`${d}T00:00:00+09:00`);
const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};
const kstDayOf = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

export interface StatPeriod {
  from: string;
  to: string;
}

/* ---------- A-STA-020 운영 통계 ---------- */

export async function opsStats(filter: BranchFilter, q: StatPeriod) {
  const db = getDb();
  const orders = await db
    .select({ id: serviceOrder.id, status: serviceOrder.status, branchId: serviceOrder.branchId })
    .from(serviceOrder)
    .where(and(branchCond(filter), isNull(serviceOrder.deletedAt), gte(serviceOrder.requestedDate, q.from), lte(serviceOrder.requestedDate, q.to)));
  const ids = orders.map((o) => o.id);
  const pendingIds = ids.length
    ? new Set(
        (
          await db
            .selectDistinct({ id: orderStatusHistory.orderId })
            .from(orderStatusHistory)
            .where(and(inArray(orderStatusHistory.orderId, ids), eq(orderStatusHistory.toStatus, 'PENDING')))
        ).map((r) => r.id),
      )
    : new Set<number>();
  const [slots] = await db
    .select({ capacity: sql<number>`coalesce(sum(${timeSlot.capacity}), 0)::int`, booked: sql<number>`coalesce(sum(${timeSlot.bookedCount}), 0)::int` })
    .from(timeSlot)
    .where(and(branchCond(filter, timeSlot.branchId), eq(timeSlot.isClosed, false), gte(timeSlot.slotDate, q.from), lte(timeSlot.slotDate, q.to)));
  const rates = opsRates({
    orders: orders.length,
    completed: orders.filter((o) => o.status === 'COMPLETED' || o.status === 'WORK_DONE').length,
    canceled: orders.filter((o) => o.status === 'CANCELED').length,
    pendingEver: orders.filter((o) => pendingIds.has(o.id) && o.status !== 'CANCELED').length,
    slotCapacity: slots?.capacity ?? 0,
    slotBooked: slots?.booked ?? 0,
  });
  // 기기 유형별 평균 작업시간: 기간 안 끝난 작업
  const works = await db
    .select({ id: workOrder.id, orderId: workOrder.orderId, minutes: workOrder.workMinutes })
    .from(workOrder)
    .innerJoin(serviceOrder, eq(serviceOrder.id, workOrder.orderId))
    .where(and(branchCond(filter), eq(workOrder.status, 'DONE'), gte(workOrder.finishedAt, kstStart(q.from)), lt(workOrder.finishedAt, kstStart(nextDay(q.to)))));
  const types = works.length
    ? await db
        .select({ orderId: orderItem.orderId, deviceType: serviceProduct.deviceType })
        .from(orderItem)
        .innerJoin(serviceProduct, eq(serviceProduct.id, orderItem.productId))
        .where(and(inArray(orderItem.orderId, works.map((w) => w.orderId)), eq(orderItem.itemType, 'PRODUCT')))
    : [];
  const byType = avgWorkMinutesByType(works.map((w) => ({ deviceTypes: types.filter((t) => t.orderId === w.orderId).map((t) => t.deviceType), workMinutes: w.minutes })));
  return {
    counts: {
      orders: orders.length,
      completed: orders.filter((o) => o.status === 'COMPLETED' || o.status === 'WORK_DONE').length,
      canceled: orders.filter((o) => o.status === 'CANCELED').length,
      pendingEver: [...pendingIds].length,
      slotCapacity: slots?.capacity ?? 0,
      slotBooked: slots?.booked ?? 0,
      worksDone: works.length,
    },
    rates,
    byType,
  };
}

/* ---------- A-STA-030 기사 성과 ---------- */

export async function techStats(filter: BranchFilter, q: StatPeriod) {
  const db = getDb();
  const from = kstStart(q.from);
  const to = kstStart(nextDay(q.to));
  const techs = await db
    .select({ id: technician.id, name: technician.name })
    .from(technician)
    .where(and(branchCond(filter, technician.branchId), isNull(technician.deletedAt)));
  const ids = techs.map((t) => t.id);
  if (!ids.length) return [];
  const [works, reviews, vocs, ases] = await Promise.all([
    db
      .select({ techId: workOrder.mainTechnicianId, amount: workOrder.finalAmount, minutes: workOrder.workMinutes })
      .from(workOrder)
      .where(and(inArray(workOrder.mainTechnicianId, ids), eq(workOrder.status, 'DONE'), gte(workOrder.finishedAt, from), lt(workOrder.finishedAt, to))),
    db
      .select({ techId: review.technicianId, rating: review.rating })
      .from(review)
      .where(and(inArray(review.technicianId, ids), eq(review.isHidden, false), gte(review.createdAt, from), lt(review.createdAt, to))),
    db
      .select({ techId: voc.technicianId })
      .from(voc)
      .where(and(inArray(voc.technicianId, ids), eq(voc.vocType, 'COMPLAINT'), gte(voc.createdAt, from), lt(voc.createdAt, to))),
    // BR-051 귀책 AS: 반려되지 않은 AS 중 귀책 기사 기준
    db
      .select({ techId: asRequest.responsibleTechId })
      .from(asRequest)
      .where(and(inArray(asRequest.responsibleTechId, ids), ne(asRequest.status, 'REJECTED'), gte(asRequest.createdAt, from), lt(asRequest.createdAt, to))),
  ]);
  return techPerformance(
    techs.map((t) => {
      const w = works.filter((x) => x.techId === t.id);
      return {
        techId: t.id,
        name: t.name,
        jobs: w.length,
        sales: w.reduce((s, x) => s + (x.amount ?? 0), 0),
        ratings: reviews.filter((r) => r.techId === t.id).map((r) => r.rating),
        vocComplaints: vocs.filter((v) => v.techId === t.id).length,
        asCount: ases.filter((a) => a.techId === t.id).length,
        workMinutes: w.map((x) => x.minutes).filter((m): m is number => m !== null && m > 0),
      };
    }),
  );
}

/* ---------- A-STA-040 고객·CRM 통계 ---------- */

export async function customerStats(filter: BranchFilter, q: StatPeriod) {
  const db = getDb();
  const from = kstStart(q.from);
  const to = kstStart(nextDay(q.to));
  const done = await db
    .select({ customerId: serviceOrder.customerId, addressId: serviceOrder.addressId })
    .from(serviceOrder)
    .where(and(branchCond(filter), eq(serviceOrder.status, 'COMPLETED'), gte(serviceOrder.completedAt, from), lt(serviceOrder.completedAt, to)));
  const customerIds = [...new Set(done.map((d) => d.customerId))];
  const firsts = customerIds.length
    ? await db
        .select({ customerId: serviceOrder.customerId, first: sql<Date>`min(${serviceOrder.completedAt})` })
        .from(serviceOrder)
        .where(and(inArray(serviceOrder.customerId, customerIds), eq(serviceOrder.status, 'COMPLETED')))
        .groupBy(serviceOrder.customerId)
    : [];
  const split = newVsRepeat(
    firsts.map((f) => ({ firstCompletedDate: kstDayOf(new Date(f.first)) })),
    q.from,
  );
  const addressIds = [...new Set(done.map((d) => d.addressId).filter((x): x is number => x !== null))];
  const addrs = addressIds.length
    ? await db.select({ id: customerAddress.id, roadAddress: customerAddress.roadAddress, housingType: customerAddress.housingType }).from(customerAddress).where(inArray(customerAddress.id, addressIds))
    : [];
  const region = (road: string) => road.split(/\s+/).slice(0, 2).join(' ');
  // 캠페인 전환율: 기간 안 발송
  const camp = await db
    .select({
      id: campaign.id,
      name: campaign.name,
      campaignType: campaign.campaignType,
      sent: sql<number>`count(*) filter (where ${campaignTarget.status} <> 'FAILED')::int`,
      converted: sql<number>`count(${campaignTarget.convertedOrderId})::int`,
    })
    .from(campaignTarget)
    .innerJoin(campaign, eq(campaign.id, campaignTarget.campaignId))
    .leftJoin(customerAddress, and(eq(customerAddress.customerId, campaignTarget.customerId), eq(customerAddress.isDefault, true), isNull(customerAddress.deletedAt)))
    .where(and(gte(campaignTarget.sentAt, from), lt(campaignTarget.sentAt, to), branchCond(filter, customerAddress.branchId)))
    .groupBy(campaign.id, campaign.name, campaign.campaignType);
  const [signups] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(customer)
    .where(and(gte(customer.createdAt, from), lt(customer.createdAt, to)));
  return {
    split,
    signups: filter.kind === 'ALL' ? (signups?.n ?? 0) : null,
    regions: distribution(addrs.map((a) => region(a.roadAddress))).slice(0, 15),
    housing: distribution(addrs.map((a) => a.housingType)),
    campaigns: camp.map((c) => ({ ...c, conversionRate: pctOf(c.converted, c.sent) })),
  };
}
