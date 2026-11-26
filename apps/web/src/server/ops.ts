import 'server-only';
/**
 * 운영 지표 서버 서비스 (단계 8-2): F-ADM-DSH-01 운영 현황(A-DSH-010) · F-ADM-DSH-02 KPI(A-DSH-020) · F-ADM-STA-01 매출 통계(A-STA-010).
 * KPI 산출식은 ERD §5 를 domain(ops-rules)에 두고, 여기서는 원천 테이블을 모아 넘긴다. 목표값은 system_setting(KPI_TARGET_*).
 * 매출 = 완료(COMPLETED) 주문 금액(완료 시각 한국 날짜 기준), 환불은 따로 빼서 순매출을 보인다. 거점 범위(BR-102)는 주문 거점.
 */
import { asRequest, branch, orderItem, refund, payment, serviceOrder, serviceProduct, technician, timeSlot, voc } from '@aircon/db';
import {
  type BranchFilter,
  type StatUnit,
  SETTING_KEYS,
  addMonthsToDate,
  bucketOf,
  evaluateKpi,
  isPeakMonth,
  kpiAsComplaintRate,
  kpiCac,
  kpiMargin,
  kpiNps,
  kpiOffPeakRatio,
  kpiRetention,
  kpiRevisitRate,
  kstDate,
} from '@aircon/domain';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { branchCond } from './admin-orders';
import { getDb } from './db';
import { longPendingIds } from './pending';
import { getSettingNumber } from './settings';

const kstStart = (d: string) => new Date(`${d}T00:00:00+09:00`);
const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};
const kstDayOf = (col: unknown) => sql<string>`to_char(${col} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;

/* ---------- A-DSH-010 운영 현황 (오늘) ---------- */

export async function operationsToday(filter: BranchFilter, now = new Date()) {
  const db = getDb();
  const today = kstDate(now);
  const start = kstStart(today);
  const end = kstStart(nextDay(today));
  const bc = branchCond(filter);
  const count = async (where: ReturnType<typeof and>) => (await db.select({ n: sql<number>`count(*)::int` }).from(serviceOrder).where(where))[0]?.n ?? 0;
  const alertHours = await getSettingNumber(SETTING_KEYS.UNASSIGNED_ALERT_HOURS);
  const [received, assignWait, inProgress, pending, workDoneToday, slots, urgent, pendingRows, techs] = await Promise.all([
    count(and(bc, isNull(serviceOrder.deletedAt), gte(serviceOrder.createdAt, start), lt(serviceOrder.createdAt, end))),
    count(and(bc, isNull(serviceOrder.deletedAt), inArray(serviceOrder.status, ['RECEIVED', 'ASSIGN_WAIT']))),
    count(and(bc, isNull(serviceOrder.deletedAt), inArray(serviceOrder.status, ['ON_THE_WAY', 'IN_PROGRESS']))),
    count(and(bc, isNull(serviceOrder.deletedAt), eq(serviceOrder.status, 'PENDING'))),
    db
      .execute(
        sql`select count(distinct h.order_id)::int as n from order_status_history h join service_order o on o.id = h.order_id
          where h.to_status = 'WORK_DONE' and h.created_at >= ${start.toISOString()}::timestamptz and h.created_at < ${end.toISOString()}::timestamptz
          ${filter.kind === 'BRANCH' ? sql`and o.branch_id = ${filter.branchId}` : filter.kind === 'NONE' ? sql`and false` : sql``}`,
      )
      .then((r) => Number((r as unknown as { n: number }[])[0]?.n ?? 0)),
    db
      .select({ branchId: timeSlot.branchId, name: branch.name, capacity: sql<number>`sum(${timeSlot.capacity})::int`, booked: sql<number>`sum(${timeSlot.bookedCount})::int` })
      .from(timeSlot)
      .innerJoin(branch, eq(branch.id, timeSlot.branchId))
      .where(and(branchCond(filter, timeSlot.branchId), eq(timeSlot.slotDate, today), eq(timeSlot.isClosed, false)))
      .groupBy(timeSlot.branchId, branch.name)
      .orderBy(asc(branch.name)),
    db
      .select({ id: serviceOrder.id, orderNo: serviceOrder.orderNo, status: serviceOrder.status, promisedAt: serviceOrder.promisedAt, branchName: branch.name })
      .from(serviceOrder)
      .innerJoin(branch, eq(branch.id, serviceOrder.branchId))
      .where(
        and(
          bc,
          isNull(serviceOrder.deletedAt),
          inArray(serviceOrder.status, ['RECEIVED', 'ASSIGN_WAIT']),
          isNotNull(serviceOrder.promisedAt),
          lt(serviceOrder.promisedAt, new Date(now.getTime() + alertHours * 3600_000)),
        ),
      )
      .orderBy(asc(serviceOrder.promisedAt))
      .limit(50),
    db
      .select({ id: serviceOrder.id, orderNo: serviceOrder.orderNo, status: serviceOrder.status, promisedAt: serviceOrder.promisedAt, pendingReason: serviceOrder.pendingReason, branchName: branch.name })
      .from(serviceOrder)
      .innerJoin(branch, eq(branch.id, serviceOrder.branchId))
      .where(and(bc, isNull(serviceOrder.deletedAt), eq(serviceOrder.status, 'PENDING')))
      .limit(300),
    db
      .select({
        branchName: branch.name,
        active: sql<number>`count(*) filter (where ${technician.status} = 'ACTIVE')::int`,
        onDuty: sql<number>`count(*) filter (where ${technician.dutyStartedAt} is not null)::int`,
        working: sql<number>`count(*) filter (where exists (select 1 from assignment a join service_order o on o.id = a.order_id
          where a.technician_id = ${technician.id} and a.role = 'MAIN' and a.status in ('ACCEPTED','TRANSFER_REQUESTED') and o.status in ('ON_THE_WAY','IN_PROGRESS')))::int`,
      })
      .from(technician)
      .innerJoin(branch, eq(branch.id, technician.branchId))
      .where(and(branchCond(filter, technician.branchId), isNull(technician.deletedAt)))
      .groupBy(branch.name)
      .orderBy(asc(branch.name)),
  ]);
  const overdue = await longPendingIds(pendingRows, now);
  return {
    today,
    counts: { received, assignWait, inProgress, workDone: workDoneToday, pending },
    slots: slots.map((s) => ({ ...s, rate: s.capacity > 0 ? Math.round((s.booked / s.capacity) * 1000) / 10 : null })),
    urgent,
    longPending: pendingRows.filter((r) => overdue.has(r.id)),
    techs,
  };
}

/* ---------- A-DSH-020 KPI ---------- */

async function completedIn(filter: BranchFilter, from: string, toExclusive: string) {
  return getDb()
    .select({ id: serviceOrder.id, customerId: serviceOrder.customerId, total: serviceOrder.totalAmount, completedAt: serviceOrder.completedAt })
    .from(serviceOrder)
    .where(and(branchCond(filter), eq(serviceOrder.status, 'COMPLETED'), gte(serviceOrder.completedAt, kstStart(from)), lt(serviceOrder.completedAt, kstStart(toExclusive))));
}

const monthStart = (month: string) => `${month}-01`;
const monthAfter = (month: string) => addMonthsToDate(monthStart(month), 1);

export type KpiCard = {
  key: string;
  label: string;
  value: number | null;
  unit: '건' | '원' | '%';
  target: number | null;
  better: 'HIGHER' | 'LOWER';
  state: 'MET' | 'BELOW' | 'NA';
  note?: string;
};

export async function kpiDashboard(filter: BranchFilter, month: string, now = new Date()) {
  const db = getDb();
  const from = monthStart(month);
  const to = monthAfter(month);
  const done = await completedIn(filter, from, to);
  const revenue = done.reduce((s, o) => s + o.total, 0);
  const ids = done.map((o) => o.id);
  const [pay] = ids.length
    ? ((await db.execute(
        sql`select coalesce(sum(pay_amount), 0)::int as n from settlement_item where item_type in ('JOB','EXTRA') and order_id in ${sql.raw(`(${ids.join(',')})`)}`,
      )) as unknown as { n: number }[])
    : [{ n: 0 }];
  const margin = kpiMargin({ revenue, jobs: done.length, techPay: Number(pay?.n ?? 0), materialCost: 0 });

  // 재방문율: 전년 같은 달 완료 고객 중 올해(1월~이번 달) 다시 주문한 고객
  const lyMonth = addMonthsToDate(from, -12).slice(0, 7);
  const base = await completedIn(filter, monthStart(lyMonth), monthAfter(lyMonth));
  const baseIds = [...new Set(base.map((b) => b.customerId))];
  const re = baseIds.length
    ? await db
        .select({ customerId: serviceOrder.customerId })
        .from(serviceOrder)
        .where(
          and(
            inArray(serviceOrder.customerId, baseIds),
            sql`${serviceOrder.status} <> 'CANCELED'`,
            gte(serviceOrder.createdAt, kstStart(`${month.slice(0, 4)}-01-01`)),
            lt(serviceOrder.createdAt, kstStart(to)),
          ),
        )
    : [];
  const revisit = kpiRevisitRate({ baseCustomers: baseIds, reorderedCustomers: re.map((r) => r.customerId) });

  const techs = await db
    .select({ joinedAt: technician.joinedAt, status: technician.status })
    .from(technician)
    .where(and(branchCond(filter, technician.branchId), isNull(technician.deletedAt)));
  // 지난달을 보면 그달 말(다음 달 1일) 기준, 이번 달이면 오늘 기준
  const retentionAsOf = kstDate(now) < to ? kstDate(now) : to;
  const retention = kpiRetention(techs, retentionAsOf);

  // 최근 12개월 월별 매출·건수 (추이 + 비수기/성수기 비)
  const months: { month: string; revenue: number; jobs: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const m = addMonthsToDate(from, -i).slice(0, 7);
    const rows = i === 0 ? done : await completedIn(filter, monthStart(m), monthAfter(m));
    months.push({ month: m, revenue: rows.reduce((s, o) => s + o.total, 0), jobs: rows.length });
  }
  const offPeak = kpiOffPeakRatio(months.filter((m) => m.revenue > 0));

  const [asCount, complaintCount, newCustomers, marketingCost] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(asRequest)
      .where(and(branchCond(filter, asRequest.branchId), gte(asRequest.createdAt, kstStart(from)), lt(asRequest.createdAt, kstStart(to))))
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(voc)
      .where(and(branchCond(filter, voc.branchId), eq(voc.vocType, 'COMPLAINT'), gte(voc.createdAt, kstStart(from)), lt(voc.createdAt, kstStart(to))))
      .then((r) => r[0]?.n ?? 0),
    db
      .execute(
        sql`select count(*)::int as n from customer c where c.created_at >= ${kstStart(from).toISOString()}::timestamptz and c.created_at < ${kstStart(to).toISOString()}::timestamptz
          ${filter.kind === 'BRANCH' ? sql`and exists (select 1 from customer_address a where a.customer_id = c.id and a.branch_id = ${filter.branchId})` : filter.kind === 'NONE' ? sql`and false` : sql``}`,
      )
      .then((r) => Number((r as unknown as { n: number }[])[0]?.n ?? 0)),
    getSettingNumber(SETTING_KEYS.MARKETING_COST_MONTHLY),
  ]);
  const asRate = kpiAsComplaintRate({ asCount, complaintCount, completed: done.length });
  const cac = kpiCac({ marketingCost: marketingCost > 0 ? marketingCost : null, newCustomers, avgTicket: margin.avgTicket });
  const nps = kpiNps([]); // 후기(review)는 단계 9

  const t = async (k: string) => getSettingNumber(k);
  const [tJobs, tMargin, tRevisit, tRetention, tOff, tAs, tCac] = await Promise.all([
    t(SETTING_KEYS.KPI_TARGET_MONTHLY_JOBS),
    t(SETTING_KEYS.KPI_TARGET_MARGIN_RATE),
    t(SETTING_KEYS.KPI_TARGET_REVISIT_RATE),
    t(SETTING_KEYS.KPI_TARGET_RETENTION_RATE),
    t(SETTING_KEYS.KPI_TARGET_OFFPEAK_RATIO),
    t(SETTING_KEYS.KPI_TARGET_AS_RATE),
    t(SETTING_KEYS.KPI_TARGET_CAC_RATE),
  ]);
  const card = (c: Omit<KpiCard, 'state'>): KpiCard => ({ ...c, state: evaluateKpi(c.value, c.target, c.better) });
  const cards: KpiCard[] = [
    card({ key: 'jobs', label: '월 처리 건수', value: done.length, unit: '건', target: isPeakMonth(Number(month.slice(5, 7))) ? tJobs : null, better: 'HIGHER', note: '목표는 성수기(5~8월) 기준' }),
    card({ key: 'avgTicket', label: '건당 객단가', value: margin.avgTicket, unit: '원', target: null, better: 'HIGHER' }),
    card({ key: 'margin', label: '마진율', value: margin.marginRate, unit: '%', target: tMargin, better: 'HIGHER', note: '매출 − 정산 지급(자재원가는 단계 9 자재 사용부터)' }),
    card({ key: 'revisit', label: '재방문율', value: revisit, unit: '%', target: tRevisit, better: 'HIGHER', note: '전년 같은 달 완료 고객 중 올해 다시 주문한 비율' }),
    card({ key: 'retention', label: '기사 6개월 정착률', value: retention, unit: '%', target: tRetention, better: 'HIGHER' }),
    card({ key: 'offPeak', label: '비수기/성수기 매출 비', value: offPeak, unit: '%', target: tOff, better: 'HIGHER', note: '최근 12개월' }),
    card({ key: 'asRate', label: 'AS·불만율', value: asRate, unit: '%', target: tAs, better: 'LOWER' }),
    card({
      key: 'cac',
      label: '고객 획득비(CAC)',
      value: cac.cac,
      unit: '원',
      target: null,
      better: 'LOWER',
      note: cac.cac === null ? '시스템 설정 MARKETING_COST_MONTHLY(월 마케팅비)를 입력하면 계산됩니다' : `객단가 대비 ${cac.cacRate ?? '-'}% (목표 ${tCac}% 이하)`,
    }),
    card({ key: 'nps', label: 'NPS', value: nps, unit: '%', target: null, better: 'HIGHER', note: '후기·평점(단계 9)부터 집계' }),
  ];
  return { month, cards, trend: months.slice(-6) };
}

/* ---------- A-STA-010 매출 통계 ---------- */

export type SalesDimension = 'BRANCH' | 'PRODUCT' | 'CHANNEL' | 'CUSTOMER_TYPE';

export async function salesStats(filter: BranchFilter, q: { from: string; to: string; unit: StatUnit; dimension: SalesDimension }) {
  const db = getDb();
  const end = nextDay(q.to);
  const orders = await db
    .select({
      id: serviceOrder.id,
      day: kstDayOf(serviceOrder.completedAt),
      total: serviceOrder.totalAmount,
      channel: serviceOrder.channel,
      branchName: branch.name,
      customerType: sql<string>`(select customer_type from customer c where c.id = ${serviceOrder.customerId})`,
    })
    .from(serviceOrder)
    .innerJoin(branch, eq(branch.id, serviceOrder.branchId))
    .where(and(branchCond(filter), eq(serviceOrder.status, 'COMPLETED'), gte(serviceOrder.completedAt, kstStart(q.from)), lt(serviceOrder.completedAt, kstStart(end))));
  const refunds = await db
    .select({ day: kstDayOf(refund.refundedAt), amount: refund.amount })
    .from(refund)
    .innerJoin(payment, eq(payment.id, refund.paymentId))
    .innerJoin(serviceOrder, eq(serviceOrder.id, payment.orderId))
    .where(and(branchCond(filter), eq(refund.status, 'DONE'), gte(refund.refundedAt, kstStart(q.from)), lt(refund.refundedAt, kstStart(end))));

  const buckets = new Map<string, { key: string; revenue: number; count: number; refund: number }>();
  const bucket = (k: string) => buckets.get(k) ?? buckets.set(k, { key: k, revenue: 0, count: 0, refund: 0 }).get(k)!;
  for (const o of orders) {
    const b = bucket(bucketOf(o.day, q.unit));
    b.revenue += o.total;
    b.count += 1;
  }
  for (const r of refunds) bucket(bucketOf(r.day, q.unit)).refund += r.amount;

  const groups = new Map<string, { label: string; revenue: number; count: number }>();
  const add = (label: string, revenue: number, count: number) => {
    const g = groups.get(label) ?? groups.set(label, { label, revenue: 0, count: 0 }).get(label)!;
    g.revenue += revenue;
    g.count += count;
  };
  if (q.dimension === 'PRODUCT') {
    const ids = orders.map((o) => o.id);
    const items = ids.length
      ? await db
          .select({ name: serviceProduct.name, amount: orderItem.amount, qty: orderItem.quantity })
          .from(orderItem)
          .leftJoin(serviceProduct, eq(serviceProduct.id, orderItem.productId))
          .where(and(inArray(orderItem.orderId, ids), eq(orderItem.itemType, 'PRODUCT')))
      : [];
    for (const i of items) add(i.name ?? '기타', i.amount, i.qty);
  } else {
    for (const o of orders) add(q.dimension === 'BRANCH' ? o.branchName : q.dimension === 'CHANNEL' ? o.channel : (o.customerType ?? 'PERSONAL'), o.total, 1);
  }
  const season = { peak: 0, off: 0 };
  for (const o of orders) season[isPeakMonth(Number(o.day.slice(5, 7))) ? 'peak' : 'off'] += o.total;
  const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
  const totalRefund = refunds.reduce((s, r) => s + r.amount, 0);
  return {
    buckets: [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)),
    groups: [...groups.values()].sort((a, b) => b.revenue - a.revenue),
    season,
    total: { revenue: totalRevenue, refund: totalRefund, net: totalRevenue - totalRefund, count: orders.length },
  };
}
