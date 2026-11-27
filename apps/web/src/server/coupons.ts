import 'server-only';
/**
 * 쿠폰 (단계 9): 쿠폰함 C-MY-020(F-CUS-CPN-01), 결제 화면 쿠폰 적용 C-PAY-010(F-CUS-PAY-04), 쿠폰 관리 A-CRM-030(F-ADM-CRM-03).
 * - 쿠폰 할인은 주문 항목 DISCOUNT 1행(상품·옵션·할증 없음)으로 남기고 주문 할인·합계를 다시 계산한다(BR-010, CLAUDE.md §5)
 * - 결제 전(UNPAID, 작업 전)에만 적용·해제. 주문 취소 때 쓴 쿠폰을 돌려준다(restoreCouponOnCancel)
 * - 발급 한도(issue_limit)는 issued_count 조건부 증가로 지킨다. 같은 쿠폰은 고객당 1장(customer_coupon_uk)
 */
import type { couponInput, couponIssueInput, z } from '@aircon/contracts';
import { coupon, customer, customerAddress, customerCoupon, orderItem, serviceOrder, serviceProduct } from '@aircon/db';
import {
  checkCouponInput,
  codeRegisterError,
  couponDiscountOf,
  couponUnusableReason,
  customerCouponState,
  issuableCount,
  kstDate,
  normalizeCouponCode,
} from '@aircon/domain';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { UserError, ValidationFailed } from './action-result';
import { getDb } from './db';
import { notifyCustomer } from './notify';
import type { Actor, Tx } from './orders';
import { formatDate } from '@/customer/format';

type Db = ReturnType<typeof getDb>;
type CouponRow = typeof coupon.$inferSelect;

/** 결제 전 쿠폰을 바꿀 수 있는 주문 상태 */
export const COUPON_EDITABLE_ORDER_STATUSES = ['QUOTED', 'RECEIVED', 'ASSIGN_WAIT', 'ASSIGNED'] as const;

const isCouponItem = (i: { itemType: string; productId: number | null; optionId: number | null; surchargeRuleId: number | null }) =>
  i.itemType === 'DISCOUNT' && i.productId === null && i.optionId === null && i.surchargeRuleId === null;

/* ---------- 고객 ---------- */

/** C-MY-020 쿠폰함: 보유·사용·만료 */
export async function listMyCoupons(customerId: number, now = new Date()) {
  const today = kstDate(now);
  const rows = await getDb()
    .select({ cc: customerCoupon, c: coupon, orderNo: serviceOrder.orderNo })
    .from(customerCoupon)
    .innerJoin(coupon, eq(coupon.id, customerCoupon.couponId))
    .leftJoin(serviceOrder, eq(serviceOrder.id, customerCoupon.usedOrderId))
    .where(eq(customerCoupon.customerId, customerId))
    .orderBy(desc(customerCoupon.issuedAt));
  return rows.map((r) => ({
    id: r.cc.id,
    name: r.c.name,
    discountType: r.c.discountType,
    discountValue: r.c.discountValue,
    maxDiscount: r.c.maxDiscount,
    minOrderAmount: r.c.minOrderAmount,
    validFrom: r.c.validFrom,
    validTo: r.c.validTo,
    state: customerCouponState(r.cc.status, r.c.validTo, today),
    usedOrderNo: r.orderNo,
  }));
}

/** 발급 1장 (한도 조건부 증가 + 고객 쿠폰 1행). 이미 받았으면 false */
async function issueOne(tx: Tx | Db, c: CouponRow, customerId: number, by: { issuedBy: number | null; campaignId: number | null }, now: Date) {
  const has = await tx.select({ id: customerCoupon.id }).from(customerCoupon).where(and(eq(customerCoupon.couponId, c.id), eq(customerCoupon.customerId, customerId)));
  if (has.length) return false;
  const bumped = await tx
    .update(coupon)
    .set({ issuedCount: sql`${coupon.issuedCount} + 1`, updatedAt: now })
    .where(and(eq(coupon.id, c.id), sql`(${coupon.issueLimit} is null or ${coupon.issuedCount} < ${coupon.issueLimit})`))
    .returning({ id: coupon.id });
  if (!bumped.length) throw new UserError('쿠폰이 모두 소진되었습니다.');
  await tx.insert(customerCoupon).values({ couponId: c.id, customerId, status: 'ISSUED', issuedAt: now, issuedBy: by.issuedBy, campaignId: by.campaignId });
  return true;
}

/** F-CUS-CPN-01 코드 등록 */
export async function registerCouponCode(customerId: number, raw: string, now = new Date()) {
  const db = getDb();
  const code = normalizeCouponCode(raw);
  const [c] = await db
    .select()
    .from(coupon)
    .where(and(eq(coupon.code, code), eq(coupon.isActive, true), isNull(coupon.deletedAt)));
  const has = c
    ? await db.select({ id: customerCoupon.id }).from(customerCoupon).where(and(eq(customerCoupon.couponId, c.id), eq(customerCoupon.customerId, customerId)))
    : [];
  const err = codeRegisterError({ coupon: c ?? null, issueLimit: c?.issueLimit ?? null, issuedCount: c?.issuedCount ?? 0, alreadyHas: has.length > 0, today: kstDate(now) });
  if (err) throw new UserError(err);
  await db.transaction((tx) => issueOne(tx, c!, customerId, { issuedBy: null, campaignId: null }, now));
  return { name: c!.name };
}

async function orderCategoryIds(orderId: number) {
  const rows = await getDb()
    .selectDistinct({ id: serviceProduct.categoryId })
    .from(orderItem)
    .innerJoin(serviceProduct, eq(serviceProduct.id, orderItem.productId))
    .where(eq(orderItem.orderId, orderId));
  return rows.map((r) => r.id);
}

/** 쿠폰 적용 전 금액(이미 쓴 쿠폰 할인은 되돌린 금액) */
const amountBeforeCoupon = (o: { totalAmount: number }, items: { itemType: string; productId: number | null; optionId: number | null; surchargeRuleId: number | null; amount: number }[]) =>
  o.totalAmount - items.filter(isCouponItem).reduce((s, i) => s + i.amount, 0);

/** C-PAY-010 쿠폰 선택지: 보유 쿠폰마다 쓸 수 있는지·할인액 */
export async function couponChoicesForOrder(customerId: number, orderNo: string, now = new Date()) {
  const db = getDb();
  const [o] = await db.select().from(serviceOrder).where(and(eq(serviceOrder.orderNo, orderNo), eq(serviceOrder.customerId, customerId)));
  if (!o) return null;
  const items = await db.select().from(orderItem).where(eq(orderItem.orderId, o.id));
  const base = amountBeforeCoupon(o, items);
  const cats = await orderCategoryIds(o.id);
  const today = kstDate(now);
  const mine = await db
    .select({ cc: customerCoupon, c: coupon })
    .from(customerCoupon)
    .innerJoin(coupon, eq(coupon.id, customerCoupon.couponId))
    .where(and(eq(customerCoupon.customerId, customerId), inArray(customerCoupon.status, ['ISSUED', 'USED'])));
  const choices = mine
    .filter((r) => r.cc.status === 'ISSUED' || r.cc.usedOrderId === o.id)
    .map((r) => {
      const reason = r.cc.usedOrderId === o.id ? null : couponUnusableReason({ coupon: r.c, customerCouponStatus: r.cc.status, today, orderAmount: base, orderCategoryIds: cats });
      return { id: r.cc.id, name: r.c.name, validTo: r.c.validTo, discount: reason ? 0 : couponDiscountOf(r.c, base), reason, applied: r.cc.usedOrderId === o.id };
    });
  return { baseAmount: base, editable: o.paidAmount === 0 && o.paymentStatus === 'UNPAID' && (COUPON_EDITABLE_ORDER_STATUSES as readonly string[]).includes(o.status), choices };
}

/** 주문에서 쿠폰을 떼어 낸다(할인 행 삭제·금액 복원·고객 쿠폰 ISSUED) */
async function detachCoupon(tx: Tx, o: typeof serviceOrder.$inferSelect, now: Date, actorId: number | null) {
  const items = await tx.select().from(orderItem).where(eq(orderItem.orderId, o.id));
  const couponItems = items.filter(isCouponItem);
  const off = -couponItems.reduce((s, i) => s + i.amount, 0);
  if (couponItems.length) await tx.delete(orderItem).where(inArray(orderItem.id, couponItems.map((i) => i.id)));
  await tx
    .update(customerCoupon)
    .set({ status: 'ISSUED', usedOrderId: null, usedAt: null })
    .where(and(eq(customerCoupon.usedOrderId, o.id), eq(customerCoupon.status, 'USED')));
  const next = { discountAmount: o.discountAmount - off, totalAmount: o.totalAmount + off, couponId: null, updatedAt: now, updatedBy: actorId };
  await tx.update(serviceOrder).set(next).where(eq(serviceOrder.id, o.id));
  return { ...o, ...next };
}

/** F-CUS-PAY-04 쿠폰 적용·해제 (customerCouponId=null 이면 해제) */
export async function applyCoupon(customerId: number, orderNo: string, customerCouponId: number | null, now = new Date()) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [o] = await tx
      .select()
      .from(serviceOrder)
      .where(and(eq(serviceOrder.orderNo, orderNo), eq(serviceOrder.customerId, customerId)))
      .for('update');
    if (!o) throw new UserError('예약을 찾을 수 없어요.');
    if (o.paidAmount !== 0 || o.paymentStatus !== 'UNPAID' || !(COUPON_EDITABLE_ORDER_STATUSES as readonly string[]).includes(o.status))
      throw new UserError('결제 전 예약에만 쿠폰을 쓸 수 있어요.');
    const base = await detachCoupon(tx, o, now, customerId);
    if (!customerCouponId) return { totalAmount: base.totalAmount, discount: 0 };
    const [r] = await tx
      .select({ cc: customerCoupon, c: coupon })
      .from(customerCoupon)
      .innerJoin(coupon, eq(coupon.id, customerCoupon.couponId))
      .where(and(eq(customerCoupon.id, customerCouponId), eq(customerCoupon.customerId, customerId)));
    if (!r) throw new UserError('쿠폰을 찾을 수 없어요.');
    const reason = couponUnusableReason({ coupon: r.c, customerCouponStatus: r.cc.status, today: kstDate(now), orderAmount: base.totalAmount, orderCategoryIds: await orderCategoryIds(o.id) });
    if (reason) throw new UserError(reason);
    const d = couponDiscountOf(r.c, base.totalAmount);
    if (d <= 0) throw new UserError('이 예약에는 할인되는 금액이 없어요.');
    await tx.insert(orderItem).values({ orderId: o.id, itemType: 'DISCOUNT', quantity: 1, unitPrice: -d, amount: -d });
    const used = await tx
      .update(customerCoupon)
      .set({ status: 'USED', usedOrderId: o.id, usedAt: now })
      .where(and(eq(customerCoupon.id, r.cc.id), eq(customerCoupon.status, 'ISSUED')))
      .returning({ id: customerCoupon.id });
    if (!used.length) throw new UserError('이미 사용한 쿠폰입니다.');
    await tx
      .update(serviceOrder)
      .set({ discountAmount: base.discountAmount + d, totalAmount: base.totalAmount - d, couponId: r.c.id, updatedAt: now, updatedBy: customerId })
      .where(eq(serviceOrder.id, o.id));
    return { totalAmount: base.totalAmount - d, discount: d };
  });
}

/** 주문 취소 때 쓴 쿠폰을 돌려준다(금액·항목은 취소 주문이라 그대로 둔다) */
export async function restoreCouponOnCancel(tx: Tx, orderId: number) {
  await tx
    .update(customerCoupon)
    .set({ status: 'ISSUED', usedOrderId: null, usedAt: null })
    .where(and(eq(customerCoupon.usedOrderId, orderId), eq(customerCoupon.status, 'USED')));
}

/* ---------- A-CRM-030 관리자 ---------- */

export async function listCoupons() {
  const db = getDb();
  const rows = await db.select().from(coupon).where(isNull(coupon.deletedAt)).orderBy(desc(coupon.id));
  const used = await db
    .select({ couponId: customerCoupon.couponId, n: sql<number>`count(*)::int` })
    .from(customerCoupon)
    .where(eq(customerCoupon.status, 'USED'))
    .groupBy(customerCoupon.couponId);
  return rows.map((c) => ({ ...c, usedCount: used.find((u) => u.couponId === c.id)?.n ?? 0 }));
}

export async function saveCoupon(input: z.output<typeof couponInput>, actor: Actor, now = new Date()) {
  const db = getDb();
  const code = normalizeCouponCode(input.code);
  const e = checkCouponInput({ ...input, code });
  if (Object.keys(e).length) throw new ValidationFailed(e);
  const values = {
    code,
    name: input.name,
    discountType: input.discountType,
    discountValue: input.discountValue,
    maxDiscount: input.maxDiscount,
    minOrderAmount: input.minOrderAmount ?? 0,
    validFrom: input.validFrom,
    validTo: input.validTo,
    issueLimit: input.issueLimit,
    targetCategoryId: input.targetCategoryId,
    isActive: input.isActive,
    updatedAt: now,
    updatedBy: actor.id,
  };
  if (input.id) {
    const [cur] = await db.select().from(coupon).where(eq(coupon.id, input.id));
    if (!cur) throw new UserError('쿠폰을 찾을 수 없습니다.');
    if (input.issueLimit !== null && input.issueLimit < cur.issuedCount) throw new ValidationFailed({ issueLimit: `이미 ${cur.issuedCount}장 발급했습니다.` });
    await db.update(coupon).set(values).where(eq(coupon.id, input.id));
    return input.id;
  }
  const [row] = await db.insert(coupon).values({ ...values, createdBy: actor.id }).returning({ id: coupon.id });
  return row!.id;
}

export async function deleteCoupon(id: number, actor: Actor, now = new Date()) {
  const db = getDb();
  const [c] = await db.select().from(coupon).where(eq(coupon.id, id));
  if (!c) throw new UserError('쿠폰을 찾을 수 없습니다.');
  if (c.issuedCount > 0) throw new UserError('이미 발급한 쿠폰은 삭제할 수 없습니다. 사용 안 함으로 바꿔 주세요.');
  await db.update(coupon).set({ deletedAt: now, updatedAt: now, updatedBy: actor.id }).where(eq(coupon.id, id));
}

/**
 * 발급: CUSTOMERS = 고객번호 목록(쉼표·줄바꿈), BULK = 마케팅 동의 활동 고객(거점 선택 시 그 거점 주소 고객).
 * 이미 받은 고객은 건너뛰고, 한도까지만 발급한다. 발급 안내(COUPON_ISSUED)는 마케팅 동의 고객에게만.
 */
export async function issueCoupons(input: z.output<typeof couponIssueInput>, actor: Actor, opts: { campaignId?: number | null; notify?: boolean } = {}, now = new Date()) {
  const db = getDb();
  const [c] = await db.select().from(coupon).where(and(eq(coupon.id, input.couponId), isNull(coupon.deletedAt)));
  if (!c || !c.isActive) throw new UserError('사용 중인 쿠폰을 골라 주세요.');
  if (c.validTo < kstDate(now)) throw new UserError('사용 기간이 지난 쿠폰입니다.');
  let targets: { id: number; marketingAgree: boolean }[];
  if (input.mode === 'CUSTOMERS') {
    const nos = [...new Set((input.customerNos ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))].slice(0, 1000);
    if (!nos.length) throw new ValidationFailed({ customerNos: '고객번호는(는) 필수 입력값입니다.' });
    targets = await db
      .select({ id: customer.id, marketingAgree: customer.marketingAgree })
      .from(customer)
      .where(and(inArray(customer.customerNo, nos), eq(customer.status, 'ACTIVE')));
  } else {
    targets = await db
      .selectDistinct({ id: customer.id, marketingAgree: customer.marketingAgree })
      .from(customer)
      .leftJoin(customerAddress, and(eq(customerAddress.customerId, customer.id), isNull(customerAddress.deletedAt)))
      .where(and(eq(customer.status, 'ACTIVE'), eq(customer.marketingAgree, true), input.branchId ? eq(customerAddress.branchId, input.branchId) : undefined))
      .limit(5000);
  }
  return issueToCustomers(c, targets, actor, { campaignId: opts.campaignId ?? null, notify: opts.notify ?? true }, now);
}

export async function issueToCustomers(
  c: CouponRow,
  targets: readonly { id: number; marketingAgree: boolean }[],
  actor: Actor,
  opts: { campaignId: number | null; notify: boolean },
  now = new Date(),
) {
  const db = getDb();
  let issued = 0;
  let skipped = 0;
  const room = issuableCount(c.issueLimit, c.issuedCount, targets.length);
  for (const t of targets) {
    if (issued >= room) {
      skipped++;
      continue;
    }
    const ok = await db.transaction((tx) => issueOne(tx, c, t.id, { issuedBy: actor.type === 'ADMIN' ? actor.id : null, campaignId: opts.campaignId }, now)).catch((e) => {
      if (e instanceof UserError) return false;
      throw e;
    });
    if (!ok) {
      skipped++;
      continue;
    }
    issued++;
    if (opts.notify && t.marketingAgree) await notifyCustomer('COUPON_ISSUED', t.id, { 쿠폰명: c.name, 사용기한: formatDate(new Date(`${c.validTo}T00:00:00+09:00`)) }, opts.campaignId ? { type: 'CAMPAIGN', id: opts.campaignId } : { type: 'COUPON', id: c.id });
  }
  return { issued, skipped };
}

