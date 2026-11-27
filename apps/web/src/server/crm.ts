import 'server-only';
/**
 * 재방문 자동 캠페인 서버 서비스 (단계 8-2): F-ADM-CRM-01(A-CRM-010) · F-SYS-06(매일 10:00 추출·발송).
 * - BR-091 최근 작업 후 REVISIT_MONTHS 개월 지난 마케팅 동의 고객만, BR-101 동의 철회 고객은 추출 때마다 제외.
 * - 대상 거점은 campaign.target_rule_json.branchIds(비면 전체). 고객 거점 = 기본 주소 거점.
 * - 성과: 발송 후 CAMPAIGN_CONVERSION_DAYS 안 첫 주문을 converted_order_id 로 연결(F-SYS-11 집계에서 갱신).
 */
import type { revisitCampaignInput, z } from '@aircon/contracts';
import { branch, campaign, campaignTarget, coupon, customer, customerAddress, serviceOrder } from '@aircon/db';
import { ACTIVE_ORDER_STATUSES, SETTING_KEYS, type BranchFilter, addMonthsToDate, isRevisitTarget, matchConversion } from '@aircon/domain';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { UserError } from './action-result';
import { issueToCustomers } from './coupons';
import { getDb } from './db';
import { notifyCustomer } from './notify';
import type { Actor } from './orders';
import { getSettingNumber } from './settings';

const kstToday = (now: Date) => now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const kstDay = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

interface RevisitRule {
  branchIds: number[];
}
const ruleOf = (json: unknown): RevisitRule => {
  const ids = (json as { branchIds?: unknown } | null)?.branchIds;
  return { branchIds: Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : [] };
};

/** 자동 재방문 캠페인 1건(마이그레이션이 기본 1행을 만든다) */
async function revisitCampaign() {
  const [c] = await getDb().select().from(campaign).where(eq(campaign.campaignType, 'REVISIT_AUTO')).orderBy(campaign.id).limit(1);
  if (!c) throw new UserError('재방문 자동 캠페인 설정이 없습니다. DB 준비(마이그레이션)를 먼저 실행해 주세요.');
  return c;
}

/** 대상 후보 (customerId, 거점, 최근 작업일, 마지막 발송일, 진행 중 주문 여부) */
async function revisitCandidates(rule: RevisitRule, filter: BranchFilter, now: Date) {
  const db = getDb();
  const months = await getSettingNumber(SETTING_KEYS.REVISIT_MONTHS);
  const cutoff = addMonthsToDate(kstToday(now), -months);
  const rows = await db
    .select({
      id: customer.id,
      customerNo: customer.customerNo,
      status: customer.status,
      marketingAgree: customer.marketingAgree,
      lastServiceDate: customer.lastServiceDate,
      branchId: customerAddress.branchId,
      branchName: branch.name,
    })
    .from(customer)
    .leftJoin(customerAddress, and(eq(customerAddress.customerId, customer.id), eq(customerAddress.isDefault, true), isNull(customerAddress.deletedAt)))
    .leftJoin(branch, eq(branch.id, customerAddress.branchId))
    .where(
      and(
        isNull(customer.deletedAt),
        eq(customer.status, 'ACTIVE'),
        eq(customer.marketingAgree, true),
        lte(customer.lastServiceDate, cutoff),
        rule.branchIds.length ? inArray(customerAddress.branchId, rule.branchIds) : undefined,
        filter.kind === 'ALL' ? undefined : filter.kind === 'NONE' ? sql`false` : eq(customerAddress.branchId, filter.branchId),
      ),
    )
    .limit(5000);
  if (!rows.length) return { cutoff, months, targets: [] as (typeof rows[number] & { monthsAgo: number })[] };
  const ids = rows.map((r) => r.id);
  const c = await revisitCampaign();
  const [sent, active] = await Promise.all([
    db
      .select({ customerId: campaignTarget.customerId, last: sql<Date>`max(${campaignTarget.sentAt})` })
      .from(campaignTarget)
      .where(and(eq(campaignTarget.campaignId, c.id), inArray(campaignTarget.customerId, ids)))
      .groupBy(campaignTarget.customerId),
    db
      .selectDistinct({ customerId: serviceOrder.customerId })
      .from(serviceOrder)
      .where(and(inArray(serviceOrder.customerId, ids), inArray(serviceOrder.status, [...ACTIVE_ORDER_STATUSES]))),
  ]);
  const lastSent = new Map(sent.map((s) => [s.customerId, s.last ? kstDay(new Date(s.last)) : null]));
  const activeSet = new Set(active.map((a) => a.customerId));
  const targets = rows
    .filter((r) =>
      isRevisitTarget({
        status: r.status,
        marketingAgree: r.marketingAgree,
        lastServiceDate: r.lastServiceDate,
        lastTargetedAt: lastSent.get(r.id) ?? null,
        hasActiveOrder: activeSet.has(r.id),
        cutoff,
      }),
    )
    .map((r) => ({ ...r, monthsAgo: monthsBetween(r.lastServiceDate!, kstToday(now)) }));
  return { cutoff, months, targets };
}

function monthsBetween(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

/** A-CRM-010 화면 데이터: 규칙·오늘 대상 미리보기·최근 발송·성과 */
export async function revisitOverview(filter: BranchFilter, now = new Date()) {
  const db = getDb();
  const c = await revisitCampaign();
  const rule = ruleOf(c.targetRuleJson);
  const preview = await revisitCandidates(rule, filter, now);
  const scope = filter.kind === 'ALL' ? undefined : filter.kind === 'NONE' ? sql`false` : eq(customerAddress.branchId, filter.branchId);
  const recent = await db
    .select({
      id: campaignTarget.id,
      customerNo: customer.customerNo,
      sentAt: campaignTarget.sentAt,
      status: campaignTarget.status,
      orderNo: serviceOrder.orderNo,
    })
    .from(campaignTarget)
    .innerJoin(customer, eq(customer.id, campaignTarget.customerId))
    .leftJoin(customerAddress, and(eq(customerAddress.customerId, customer.id), eq(customerAddress.isDefault, true), isNull(customerAddress.deletedAt)))
    .leftJoin(serviceOrder, eq(serviceOrder.id, campaignTarget.convertedOrderId))
    .where(and(eq(campaignTarget.campaignId, c.id), scope))
    .orderBy(desc(campaignTarget.sentAt))
    .limit(200);
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const [perf] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${campaignTarget.status} <> 'FAILED')::int`,
      failed: sql<number>`count(*) filter (where ${campaignTarget.status} = 'FAILED')::int`,
      converted: sql<number>`count(${campaignTarget.convertedOrderId})::int`,
    })
    .from(campaignTarget)
    .leftJoin(customerAddress, and(eq(customerAddress.customerId, campaignTarget.customerId), eq(customerAddress.isDefault, true), isNull(customerAddress.deletedAt)))
    .where(and(eq(campaignTarget.campaignId, c.id), gte(campaignTarget.sentAt, since), scope));
  return {
    campaign: { id: c.id, name: c.name, running: c.status === 'RUNNING', branchIds: rule.branchIds, couponId: c.couponId, updatedAt: c.updatedAt },
    months: preview.months,
    cutoff: preview.cutoff,
    preview: preview.targets.slice(0, 200).map((t) => ({ id: t.id, customerNo: t.customerNo, branchName: t.branchName, lastServiceDate: t.lastServiceDate, monthsAgo: t.monthsAgo })),
    previewCount: preview.targets.length,
    recent,
    perf: perf ?? { sent: 0, failed: 0, converted: 0 },
  };
}

/** F-ADM-CRM-01 규칙 저장(실행·중지, 대상 거점, 단계 9: 동봉 쿠폰) */
export async function saveRevisitCampaign(input: z.output<typeof revisitCampaignInput>, actor: Actor, now = new Date()) {
  const c = await revisitCampaign();
  await getDb()
    .update(campaign)
    .set({ status: input.running ? 'RUNNING' : 'STOPPED', targetRuleJson: { branchIds: input.branchIds }, couponId: input.couponId ?? null, updatedAt: now, updatedBy: actor.id })
    .where(eq(campaign.id, c.id));
}

/** F-SYS-06 매일 10:00: 대상 추출 → 알림 발송 → campaign_target 기록. 캠페인이 중지면 아무것도 하지 않는다 */
export async function runRevisitCampaign(origin: string, now = new Date()) {
  const c = await revisitCampaign();
  if (c.status !== 'RUNNING') return { skipped: true as const, sent: 0, failed: 0 };
  const { targets } = await revisitCandidates(ruleOf(c.targetRuleJson), { kind: 'ALL' }, now);
  const db = getDb();
  // 단계 9: 동봉 쿠폰이 있으면 발송 대상에게 함께 발급(안내는 재방문 알림으로 갈음)
  const [cp] = c.couponId ? await db.select().from(coupon).where(and(eq(coupon.id, c.couponId), isNull(coupon.deletedAt), eq(coupon.isActive, true))) : [];
  let sent = 0;
  let failed = 0;
  for (const t of targets) {
    if (cp) await issueToCustomers(cp, [{ id: t.id, marketingAgree: true }], { type: 'SYSTEM', id: null }, { campaignId: c.id, notify: false }, now).catch(() => undefined);
    const result = await notifyCustomer('REVISIT_11M', t.id, { 경과개월: String(t.monthsAgo), 예약링크: `${origin}/quote` }, { type: 'CAMPAIGN', id: c.id });
    if (result === 'SKIPPED') continue;
    const ok = result !== 'FAILED';
    if (ok) sent++;
    else failed++;
    await db.insert(campaignTarget).values({ campaignId: c.id, customerId: t.id, sentAt: now, status: ok ? 'SENT' : 'FAILED' });
  }
  return { skipped: false as const, sent, failed };
}

/** F-SYS-11 집계: 발송 후 전환 기간 안 첫 주문을 연결(SENT → CONVERTED) */
export async function refreshCampaignConversions(now = new Date()) {
  const db = getDb();
  const days = await getSettingNumber(SETTING_KEYS.CAMPAIGN_CONVERSION_DAYS);
  const since = new Date(now.getTime() - (days + 1) * 86_400_000);
  const open = await db
    .select({ id: campaignTarget.id, customerId: campaignTarget.customerId, sentAt: campaignTarget.sentAt })
    .from(campaignTarget)
    .where(and(eq(campaignTarget.status, 'SENT'), isNull(campaignTarget.convertedOrderId), gte(campaignTarget.sentAt, since)));
  if (!open.length) return 0;
  const orders = await db
    .select({ id: serviceOrder.id, customerId: serviceOrder.customerId, createdAt: serviceOrder.createdAt, status: serviceOrder.status })
    .from(serviceOrder)
    .where(and(inArray(serviceOrder.customerId, [...new Set(open.map((o) => o.customerId))]), gte(serviceOrder.createdAt, since)));
  let n = 0;
  for (const t of open) {
    if (!t.sentAt) continue;
    const hit = matchConversion(
      t.sentAt,
      orders.filter((o) => o.customerId === t.customerId),
      days,
    );
    if (hit === null) continue;
    await db.update(campaignTarget).set({ convertedOrderId: hit, status: 'CONVERTED', updatedAt: now }).where(eq(campaignTarget.id, t.id));
    n++;
  }
  return n;
}
