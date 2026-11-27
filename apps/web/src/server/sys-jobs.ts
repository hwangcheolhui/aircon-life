import 'server-only';
/**
 * 단계 9 시스템 배치 (02 §4):
 * - F-SYS-13 휴면 전환: DORMANT_ENABLED=Y 일 때만. 마지막 이용일(최근 작업일·최근 주문 접수일·가입일 중 가장 늦은 날)에서 DORMANT_MONTHS개월이 지난
 *   활동 고객을 휴면(DORMANT)으로 바꾸고, 전환 DORMANT_NOTICE_DAYS일 전부터 1회 사전 안내(DORMANT_NOTICE). 진행 중 주문이 있으면 제외.
 *   휴면 고객이 다시 로그인하면 활동(ACTIVE)으로 돌아온다(customers.linkAppLogin). 분리 보관 등 법무 확인 사항은 운영 전 결정(기본 사용 안 함).
 * - F-SYS-14 PG 대사: 어제(한국 날짜) 승인된 PG 결제를 PG 서버에 다시 조회(reconcilePayment와 같은 기준)해 금액·상태가 다른 건을 세고, 있으면 운영자에게 PG_MISMATCH 푸시
 */
import { customer, notificationTemplate, payment } from '@aircon/db';
import { ACTIVE_ORDER_STATUSES, SETTING_KEYS, addMonthsToDate, isDormantNoticeDue, isDormantTarget, kstDate, lastActivityDate } from '@aircon/domain';
import { createPaymentGateway } from '@aircon/integrations';
import { and, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { getDb } from './db';
import { notifyCustomer, notifyStaffWith } from './notify';
import { getSettingNumber, getSettingString } from './settings';

const BATCH = 2000;

/** F-SYS-13 */
export async function runDormant(now = new Date()) {
  if ((await getSettingString(SETTING_KEYS.DORMANT_ENABLED)) !== 'Y') return { enabled: false, noticed: 0, converted: 0 };
  const [months, noticeDays] = await Promise.all([getSettingNumber(SETTING_KEYS.DORMANT_MONTHS), getSettingNumber(SETTING_KEYS.DORMANT_NOTICE_DAYS)]);
  const db = getDb();
  const today = kstDate(now);
  // 사전 안내 범위까지 들어온 고객만 미리 거른다(가입일이 기준보다 늦으면 대상 아님)
  const createdBefore = new Date(`${addMonthsToDate(today, -months)}T00:00:00+09:00`);
  const lookahead = new Date(createdBefore.getTime() + (noticeDays + 1) * 86_400_000);
  const [tpl] = await db.select({ id: notificationTemplate.id }).from(notificationTemplate).where(eq(notificationTemplate.templateCode, 'DORMANT_NOTICE'));
  const rows = await db
    .select({
      id: customer.id,
      status: customer.status,
      createdAt: customer.createdAt,
      lastServiceDate: customer.lastServiceDate,
      lastOrderAt: sql<string | null>`(select max(o.created_at) from service_order o where o.customer_id = ${customer.id})`,
      hasActiveOrder: sql<boolean>`exists (select 1 from service_order o where o.customer_id = ${customer.id} and o.status in (${sql.join(
        ACTIVE_ORDER_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      )}))`,
      lastNoticedAt: tpl
        ? sql<string | null>`(select max(l.created_at) from notification_log l where l.template_id = ${tpl.id} and l.related_type = 'CUSTOMER' and l.related_id = ${customer.id})`
        : sql<string | null>`null`,
    })
    .from(customer)
    .where(and(eq(customer.status, 'ACTIVE'), isNull(customer.deletedAt), lt(customer.createdAt, lookahead)))
    .limit(BATCH);
  let noticed = 0;
  let converted = 0;
  for (const r of rows) {
    const lastActivity = lastActivityDate([r.lastServiceDate, r.lastOrderAt ? kstDate(new Date(r.lastOrderAt)) : null, kstDate(r.createdAt)]);
    const base = { status: r.status, lastActivity, hasActiveOrder: Boolean(r.hasActiveOrder), today, months };
    if (isDormantTarget(base)) {
      const moved = await db
        .update(customer)
        .set({ status: 'DORMANT', dormantAt: now, updatedAt: now, updatedBy: null })
        .where(and(eq(customer.id, r.id), eq(customer.status, 'ACTIVE')))
        .returning({ id: customer.id });
      if (moved.length) converted++;
      continue;
    }
    if (isDormantNoticeDue({ ...base, noticeDays, lastNoticedAt: r.lastNoticedAt ? kstDate(new Date(r.lastNoticedAt)) : null })) {
      const due = addMonthsToDate(lastActivity!, months);
      const st = await notifyCustomer('DORMANT_NOTICE', r.id, { 전환일: due.replace(/-/g, '.') }, { type: 'CUSTOMER', id: r.id });
      if (st !== 'SKIPPED') noticed++;
    }
  }
  return { enabled: true, checked: rows.length, noticed, converted };
}

/** F-SYS-14 */
export async function runPgReconcile(now = new Date()) {
  const db = getDb();
  const today = kstDate(now);
  const from = new Date(new Date(`${today}T00:00:00+09:00`).getTime() - 86_400_000);
  const to = new Date(`${today}T00:00:00+09:00`);
  const rows = await db
    .select({ id: payment.id, paymentNo: payment.paymentNo, pgProvider: payment.pgProvider, pgTid: payment.pgTid, amount: payment.amount })
    .from(payment)
    .where(and(eq(payment.status, 'APPROVED'), isNotNull(payment.pgProvider), gte(payment.approvedAt, from), lt(payment.approvedAt, to)))
    .limit(BATCH);
  const gw = createPaymentGateway();
  const mismatches: { id: number; paymentNo: string; reason: string }[] = [];
  for (const p of rows) {
    const id = p.pgProvider === 'MOCK' ? (p.pgTid ?? p.paymentNo) : p.paymentNo;
    const v = await gw.verify(id, p.amount).catch((e: Error) => ({ ok: false, failReason: e.message }));
    if (!v.ok) mismatches.push({ id: p.id, paymentNo: p.paymentNo, reason: v.failReason ?? 'PG 확인 실패' });
  }
  if (mismatches.length)
    await notifyStaffWith(
      'PG_MISMATCH',
      { type: 'ADMIN', id: null },
      { type: 'PAYMENT', id: mismatches[0]!.id },
      { 대사일: kstDate(from).replace(/-/g, '.'), 건수: String(mismatches.length) },
      '/admin/pay/payments',
    );
  if (mismatches.length) console.warn('PG 대사 불일치', mismatches);
  return { date: kstDate(from), checked: rows.length, mismatches: mismatches.length, items: mismatches.map((m) => ({ paymentNo: m.paymentNo, reason: m.reason })) };
}
