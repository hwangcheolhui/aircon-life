import 'server-only';
/**
 * A-CRM-020 시즌·타겟 캠페인 (단계 9, F-ADM-CRM-02, 01 §2.12.3·2.12.4).
 * - 조건(거점·기기·최근 작업 경과 개월·주거유형)으로 대상 추출 → 발송(템플릿) → campaign_target 기록 → 전환(주문) 추적(F-SYS-11 refreshCampaignConversions)
 * - BR-101 마케팅 동의 고객만, 추출 때마다 다시 확인. 같은 캠페인은 고객당 1회
 * - 상태 전이는 assertCampaignTransition(01 §3.16): 작성 → 예약(예약 발송 시각) → 진행중(발송 중) → 완료, 중지
 * - 쿠폰을 붙이면 발송 대상에게 쿠폰을 함께 발급하고 #{쿠폰안내} 에 쿠폰명을 넣는다
 * - 예약 발송은 매일 배치(/api/jobs/campaign-send)가 보낸다(Vercel Hobby 는 하루 1회라 예약 시각 이후 첫 실행 때)
 */
import type { campaignActionInput, campaignInput, z } from '@aircon/contracts';
import { campaign, campaignTarget, coupon, customer, customerAddress, customerDevice, notificationTemplate } from '@aircon/db';
import {
  type NotificationTemplateCode,
  assertCampaignTransition,
  checkCampaignInput,
  isCampaignDue,
  kstDate,
  matchesCampaignRule,
  parseCampaignRule,
  rateOf,
} from '@aircon/domain';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { UserError, ValidationFailed } from './action-result';
import { issueToCustomers } from './coupons';
import { getDb } from './db';
import { notifyCustomer } from './notify';
import type { Actor } from './orders';

const MAX_TARGETS = 5000;

export async function listCampaigns() {
  const db = getDb();
  const rows = await db
    .select({ c: campaign, templateName: notificationTemplate.title, couponName: coupon.name })
    .from(campaign)
    .leftJoin(notificationTemplate, eq(notificationTemplate.id, campaign.templateId))
    .leftJoin(coupon, eq(coupon.id, campaign.couponId))
    .where(ne(campaign.campaignType, 'REVISIT_AUTO'))
    .orderBy(desc(campaign.id));
  const perf = rows.length
    ? await db
        .select({
          campaignId: campaignTarget.campaignId,
          sent: sql<number>`count(*) filter (where ${campaignTarget.status} <> 'FAILED')::int`,
          failed: sql<number>`count(*) filter (where ${campaignTarget.status} = 'FAILED')::int`,
          converted: sql<number>`count(${campaignTarget.convertedOrderId})::int`,
        })
        .from(campaignTarget)
        .where(inArray(campaignTarget.campaignId, rows.map((r) => r.c.id)))
        .groupBy(campaignTarget.campaignId)
    : [];
  return rows.map((r) => {
    const p = perf.find((x) => x.campaignId === r.c.id) ?? { sent: 0, failed: 0, converted: 0 };
    return {
      id: r.c.id,
      name: r.c.name,
      campaignType: r.c.campaignType,
      status: r.c.status,
      templateId: r.c.templateId,
      templateName: r.templateName,
      couponId: r.c.couponId,
      couponName: r.couponName,
      sendAt: r.c.sendAt,
      rule: parseCampaignRule(r.c.targetRuleJson),
      sent: p.sent,
      failed: p.failed,
      converted: p.converted,
      conversionRate: rateOf(p.converted, p.sent),
    };
  });
}

/** 발송 가능한 고객 템플릿(캠페인 안내) */
export async function campaignTemplates() {
  return getDb()
    .select({ id: notificationTemplate.id, code: notificationTemplate.templateCode, title: notificationTemplate.title })
    .from(notificationTemplate)
    .where(and(eq(notificationTemplate.target, 'CUSTOMER'), eq(notificationTemplate.isActive, true), inArray(notificationTemplate.templateCode, ['CAMPAIGN_MESSAGE'])));
}

export async function saveCampaign(input: z.output<typeof campaignInput>, actor: Actor, now = new Date()) {
  const db = getDb();
  const rule = parseCampaignRule(input);
  // 화면 입력(datetime-local)은 한국 시각
  const sendAt = input.sendAt ? new Date(`${input.sendAt.slice(0, 16)}:00+09:00`) : null;
  const e = checkCampaignInput({ name: input.name, campaignType: input.campaignType, templateId: input.templateId, sendAt, now, rule });
  if (Object.keys(e).length) throw new ValidationFailed(e);
  const values = {
    name: input.name,
    campaignType: input.campaignType,
    templateId: input.templateId,
    couponId: input.couponId,
    sendAt,
    scheduleType: 'ONCE',
    targetRuleJson: rule,
    updatedAt: now,
    updatedBy: actor.id,
  };
  if (input.id) {
    const [c] = await db.select().from(campaign).where(eq(campaign.id, input.id));
    if (!c) throw new UserError('캠페인을 찾을 수 없습니다.');
    if (c.status !== 'DRAFT') throw new UserError('작성 상태의 캠페인만 고칠 수 있습니다. [작성으로]를 먼저 눌러 주세요.');
    await db.update(campaign).set(values).where(eq(campaign.id, c.id));
    return c.id;
  }
  const [row] = await db.insert(campaign).values({ ...values, status: 'DRAFT', createdBy: actor.id }).returning({ id: campaign.id });
  return row!.id;
}

/** 조건에 맞는 대상 고객 (이 캠페인 미발송) */
async function targetsOf(c: typeof campaign.$inferSelect, now: Date) {
  const db = getDb();
  const rule = parseCampaignRule(c.targetRuleJson);
  const rows = await db
    .select({
      id: customer.id,
      customerNo: customer.customerNo,
      status: customer.status,
      marketingAgree: customer.marketingAgree,
      lastServiceDate: customer.lastServiceDate,
      branchId: customerAddress.branchId,
      housingType: customerAddress.housingType,
    })
    .from(customer)
    .leftJoin(customerAddress, and(eq(customerAddress.customerId, customer.id), eq(customerAddress.isDefault, true), isNull(customerAddress.deletedAt)))
    .where(and(isNull(customer.deletedAt), eq(customer.status, 'ACTIVE'), eq(customer.marketingAgree, true), rule.branchIds.length ? inArray(customerAddress.branchId, rule.branchIds) : undefined))
    .limit(MAX_TARGETS * 2);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const [devices, done] = await Promise.all([
    rule.deviceTypes.length
      ? db.select({ customerId: customerDevice.customerId, deviceType: customerDevice.deviceType }).from(customerDevice).where(and(inArray(customerDevice.customerId, ids), isNull(customerDevice.deletedAt)))
      : Promise.resolve([] as { customerId: number; deviceType: string }[]),
    db.select({ customerId: campaignTarget.customerId }).from(campaignTarget).where(and(eq(campaignTarget.campaignId, c.id), inArray(campaignTarget.customerId, ids))),
  ]);
  const doneSet = new Set(done.map((d) => d.customerId));
  const today = kstDate(now);
  return rows
    .filter((r) =>
      matchesCampaignRule(
        {
          status: r.status,
          marketingAgree: r.marketingAgree,
          branchId: r.branchId,
          deviceTypes: devices.filter((d) => d.customerId === r.id).map((d) => d.deviceType),
          housingType: r.housingType,
          lastServiceDate: r.lastServiceDate,
          alreadyTargeted: doneSet.has(r.id),
        },
        rule,
        today,
      ),
    )
    .slice(0, MAX_TARGETS);
}

/** A-CRM-020 [대상 미리보기] */
export async function previewCampaign(id: number, now = new Date()) {
  const [c] = await getDb().select().from(campaign).where(eq(campaign.id, id));
  if (!c) throw new UserError('캠페인을 찾을 수 없습니다.');
  const t = await targetsOf(c, now);
  return { count: t.length, sample: t.slice(0, 20).map((x) => x.customerNo) };
}

/** 발송 실행: RUNNING 으로 바꾸고 대상에게 보낸 뒤 DONE */
async function sendCampaign(c: typeof campaign.$inferSelect, origin: string, actor: Actor, now: Date) {
  const db = getDb();
  assertCampaignTransition(c.status, 'RUNNING');
  const moved = await db
    .update(campaign)
    .set({ status: 'RUNNING', updatedAt: now, updatedBy: actor.id })
    .where(and(eq(campaign.id, c.id), eq(campaign.status, c.status)))
    .returning({ id: campaign.id });
  if (!moved.length) throw new UserError('다른 곳에서 먼저 처리했습니다.');
  const [t] = c.templateId ? await db.select().from(notificationTemplate).where(eq(notificationTemplate.id, c.templateId)) : [];
  if (!t) throw new UserError('발송 템플릿이 없습니다.');
  const [cp] = c.couponId ? await db.select().from(coupon).where(and(eq(coupon.id, c.couponId), isNull(coupon.deletedAt))) : [];
  const targets = await targetsOf(c, now);
  let sent = 0;
  let failed = 0;
  for (const x of targets) {
    // 쿠폰 동봉: 발급(안내는 이 캠페인 메시지로 함께) → 실패해도 메시지는 보낸다
    let couponText = '';
    if (cp && cp.isActive) {
      const r = await issueToCustomers(cp, [{ id: x.id, marketingAgree: true }], actor, { campaignId: c.id, notify: false }, now).catch(() => ({ issued: 0 }));
      if (r.issued) couponText = `${cp.name} 쿠폰을 쿠폰함에 넣어 드렸어요.`;
    }
    const st = await notifyCustomer(t.templateCode as NotificationTemplateCode, x.id, { 캠페인명: c.name, 쿠폰안내: couponText, 예약링크: `${origin}/quote` }, { type: 'CAMPAIGN', id: c.id });
    if (st === 'SKIPPED') continue;
    const ok = st !== 'FAILED';
    if (ok) sent++;
    else failed++;
    await db.insert(campaignTarget).values({ campaignId: c.id, customerId: x.id, sentAt: now, status: ok ? 'SENT' : 'FAILED', createdBy: actor.id, updatedBy: actor.id });
  }
  assertCampaignTransition('RUNNING', 'DONE');
  await db.update(campaign).set({ status: 'DONE', updatedAt: new Date(), updatedBy: actor.id }).where(and(eq(campaign.id, c.id), eq(campaign.status, 'RUNNING')));
  return { sent, failed };
}

/** [예약]·[지금 발송]·[중지]·[작성으로] */
export async function campaignAction(input: z.output<typeof campaignActionInput>, origin: string, actor: Actor, now = new Date()) {
  const db = getDb();
  const [c] = await db.select().from(campaign).where(eq(campaign.id, input.id));
  if (!c || c.campaignType === 'REVISIT_AUTO') throw new UserError('캠페인을 찾을 수 없습니다.');
  if (input.action === 'SEND_NOW') return sendCampaign(c, origin, actor, now);
  const to = input.action === 'SCHEDULE' ? 'SCHEDULED' : input.action === 'STOP' ? 'STOPPED' : 'DRAFT';
  if (to === 'SCHEDULED' && (!c.sendAt || c.sendAt.getTime() <= now.getTime())) throw new UserError('예약 발송 시각(지금 이후)을 먼저 저장해 주세요.');
  assertCampaignTransition(c.status, to);
  const rows = await db
    .update(campaign)
    .set({ status: to, updatedAt: now, updatedBy: actor.id })
    .where(and(eq(campaign.id, c.id), eq(campaign.status, c.status)))
    .returning({ id: campaign.id });
  if (!rows.length) throw new UserError('다른 곳에서 먼저 처리했습니다.');
  return null;
}

/** 배치: 예약 시각이 지난 캠페인 발송 */
export async function runScheduledCampaigns(origin: string, now = new Date()) {
  const rows = await getDb().select().from(campaign).where(eq(campaign.status, 'SCHEDULED'));
  const out: { id: number; sent: number; failed: number }[] = [];
  for (const c of rows) {
    if (!isCampaignDue(c.status, c.sendAt, now)) continue;
    try {
      out.push({ id: c.id, ...(await sendCampaign(c, origin, { type: 'SYSTEM', id: null }, now)) });
    } catch (e) {
      console.error('캠페인 발송 실패', c.id, e);
    }
  }
  return { campaigns: out.length, sent: out.reduce((s, x) => s + x.sent, 0) };
}
