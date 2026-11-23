import 'server-only';
/**
 * 관리자 고객 서버 서비스 (F-ADM-CUS-01~03, A-CUS-010·020).
 * 호출하는 서버 액션·페이지가 먼저 requirePermission/requireScreen 으로 화면 권한을 확인하고, 거점 범위(BR-102)는 customerScopeCond 로 적용한다.
 * 목록·상세는 마스킹(BR-100), 원문 열람은 호출한 쪽이 감사 로그(VIEW_PII)를 남긴다.
 */
import type { customerGradeInput, customerMemoInput, z } from '@aircon/contracts';
import { consentHistory, consultation, customer, customerAddress, customerTag, payment, serviceOrder } from '@aircon/db';
import { type BranchFilter, maskName, maskPhone } from '@aircon/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { UserError } from './action-result';
import { assertCustomerInScope, customerScopeCond } from './consult';
import { getDb } from './db';
import type { Actor } from './orders';
import { decrypt, phoneHash } from './pii';

export interface CustomerListQuery {
  name: string | null;
  phone: string | null;
  address: string | null;
  grade: string | null;
  tag: string | null;
  lastFrom: string | null;
  lastTo: string | null;
}

/** 이름은 암호화돼 있어 DB에서 찾을 수 없으므로, 다른 조건으로 좁힌 뒤 서버에서 복호화해 비교한다(최대 이 건수) */
const NAME_SCAN_LIMIT = 5000;

/** F-ADM-CUS-01 고객 목록·검색 (마스킹) */
export async function listCustomers(filter: BranchFilter, q: CustomerListQuery, limit = 500) {
  const db = getDb();
  const digits = q.phone?.replace(/[^0-9]/g, '') ?? '';
  const rows = await db
    .select({
      id: customer.id,
      customerNo: customer.customerNo,
      customerType: customer.customerType,
      name: customer.name,
      phone: customer.phone1,
      grade: customer.grade,
      status: customer.status,
      joinChannel: customer.joinChannel,
      privacyAgreeStatus: customer.privacyAgreeStatus,
      lastServiceDate: customer.lastServiceDate,
      createdAt: customer.createdAt,
      roadAddress: sql<string | null>`(select ca.road_address from customer_address ca where ca.customer_id = ${customer.id} and ca.deleted_at is null order by ca.is_default desc, ca.updated_at desc limit 1)`,
    })
    .from(customer)
    .where(
      and(
        isNull(customer.deletedAt),
        customerScopeCond(filter),
        digits ? eq(customer.phone1Hash, phoneHash(digits)) : undefined,
        q.grade ? eq(customer.grade, q.grade) : undefined,
        q.lastFrom ? gte(customer.lastServiceDate, q.lastFrom) : undefined,
        q.lastTo ? lte(customer.lastServiceDate, q.lastTo) : undefined,
        q.tag ? sql`exists (select 1 from customer_tag t where t.customer_id = ${customer.id} and t.tag_code = ${q.tag})` : undefined,
        q.address
          ? sql`exists (select 1 from customer_address ca where ca.customer_id = ${customer.id} and ca.deleted_at is null and (ca.road_address like ${`%${q.address}%`} or ca.jibun_address like ${`%${q.address}%`}))`
          : undefined,
      ),
    )
    .orderBy(desc(customer.createdAt))
    .limit(q.name ? NAME_SCAN_LIMIT : limit);
  const name = q.name?.replace(/\s/g, '') ?? '';
  const ids = rows.map((r) => r.id);
  const tags = ids.length ? await db.select().from(customerTag).where(inArray(customerTag.customerId, ids.slice(0, NAME_SCAN_LIMIT))) : [];
  return rows
    .map(({ name: n, phone, ...r }) => ({ ...r, plainName: decrypt(n) ?? '', phoneMasked: maskPhone(decrypt(phone)), tags: tags.filter((t) => t.customerId === r.id).map((t) => t.tagCode) }))
    .filter((r) => !name || r.plainName.replace(/\s/g, '').includes(name))
    .slice(0, limit)
    .map(({ plainName, ...r }) => ({ ...r, nameMasked: maskName(plainName) }));
}

/** F-ADM-CUS-02 고객 상세 (One View): 기본 · 주소·기기 · 주문 · 결제 · VOC·AS · 쿠폰 · 동의이력 · 메모 */
export async function getCustomerOneView(customerId: number, filter: BranchFilter) {
  const db = getDb();
  const [c] = await db.select().from(customer).where(and(eq(customer.id, customerId), isNull(customer.deletedAt), customerScopeCond(filter)));
  if (!c) return null;
  const [addresses, tags, orders, payments, consents, claims] = await Promise.all([
    db
      .select()
      .from(customerAddress)
      .where(and(eq(customerAddress.customerId, customerId), isNull(customerAddress.deletedAt)))
      .orderBy(desc(customerAddress.isDefault), desc(customerAddress.updatedAt)),
    db.select({ tagCode: customerTag.tagCode }).from(customerTag).where(eq(customerTag.customerId, customerId)),
    db
      .select({
        id: serviceOrder.id,
        orderNo: serviceOrder.orderNo,
        status: serviceOrder.status,
        channel: serviceOrder.channel,
        orderType: serviceOrder.orderType,
        promisedAt: serviceOrder.promisedAt,
        completedAt: serviceOrder.completedAt,
        totalAmount: serviceOrder.totalAmount,
        paymentStatus: serviceOrder.paymentStatus,
      })
      .from(serviceOrder)
      .where(and(eq(serviceOrder.customerId, customerId), isNull(serviceOrder.deletedAt)))
      .orderBy(desc(serviceOrder.createdAt)),
    db
      .select({
        id: payment.id,
        paymentNo: payment.paymentNo,
        orderNo: serviceOrder.orderNo,
        paymentStage: payment.paymentStage,
        method: payment.method,
        amount: payment.amount,
        status: payment.status,
        approvedAt: payment.approvedAt,
        createdAt: payment.createdAt,
      })
      .from(payment)
      .innerJoin(serviceOrder, eq(serviceOrder.id, payment.orderId))
      .where(eq(payment.customerId, customerId))
      .orderBy(desc(payment.createdAt)),
    db.select().from(consentHistory).where(eq(consentHistory.customerId, customerId)).orderBy(desc(consentHistory.createdAt)),
    db
      .select()
      .from(consultation)
      .where(and(eq(consultation.customerId, customerId), or(eq(consultation.consultType, 'CLAIM'), eq(consultation.consultType, 'INQUIRY'))))
      .orderBy(desc(consultation.createdAt)),
  ]);
  return {
    customer: {
      id: c.id,
      customerNo: c.customerNo,
      customerType: c.customerType,
      nameMasked: maskName(decrypt(c.name)),
      phoneMasked: maskPhone(decrypt(c.phone1)),
      phone2Masked: maskPhone(decrypt(c.phone2)),
      email: c.email,
      grade: c.grade,
      status: c.status,
      joinChannel: c.joinChannel,
      authProvider: c.authProvider,
      privacyAgreeStatus: c.privacyAgreeStatus,
      marketingAgree: c.marketingAgree,
      happycallReject: c.happycallReject,
      lastServiceDate: c.lastServiceDate,
      totalOrderCount: c.totalOrderCount,
      memo: c.memo,
      createdAt: c.createdAt,
    },
    tags: tags.map((t) => t.tagCode),
    // 상세주소는 목록·상세에서 비표시 (ERD §6 마스킹 규칙)
    addresses: addresses.map((a) => ({
      id: a.id,
      alias: a.alias,
      zipcode: a.zipcode,
      roadAddress: a.roadAddress,
      jibunAddress: a.jibunAddress,
      housingType: a.housingType,
      hasElevator: a.hasElevator,
      isDefault: a.isDefault,
    })),
    orders,
    payments,
    consents: consents.map((h) => ({ id: h.id, consentType: h.consentType, action: h.action, channel: h.channel, termsVersion: h.termsVersion, createdAt: h.createdAt })),
    consults: claims.map((x) => ({ id: x.id, consultNo: x.consultNo, consultType: x.consultType, subType: x.subType, status: x.status, content: x.content, createdAt: x.createdAt })),
  };
}

/** [보기] 원문 (호출 전 감사 로그) */
export async function revealCustomerPii(customerId: number, filter: BranchFilter) {
  const db = getDb();
  const [c] = await db
    .select({ name: customer.name, phone1: customer.phone1, phone2: customer.phone2 })
    .from(customer)
    .where(and(eq(customer.id, customerId), customerScopeCond(filter)));
  if (!c) throw new UserError('고객을 찾을 수 없거나 조회 권한이 없습니다.');
  const addrs = await db
    .select({ id: customerAddress.id, detail: customerAddress.detailAddress })
    .from(customerAddress)
    .where(and(eq(customerAddress.customerId, customerId), isNull(customerAddress.deletedAt)))
    .orderBy(asc(customerAddress.id));
  return {
    name: decrypt(c.name) ?? '',
    phone1: decrypt(c.phone1) ?? '',
    phone2: decrypt(c.phone2) ?? '',
    details: addrs.map((a) => ({ id: a.id, detailAddress: decrypt(a.detail) ?? '' })),
  };
}

/** F-ADM-CUS-03 등급·태그 (태그는 지정한 목록으로 교체) */
export async function updateGradeTags(input: z.output<typeof customerGradeInput>, filter: BranchFilter, actor: Actor) {
  await assertCustomerInScope(input.customerId, filter);
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.update(customer).set({ grade: input.grade, updatedAt: now, updatedBy: actor.id }).where(eq(customer.id, input.customerId));
    const current = await tx.select({ tagCode: customerTag.tagCode }).from(customerTag).where(eq(customerTag.customerId, input.customerId));
    const removed = current.map((t) => t.tagCode).filter((t) => !input.tags.includes(t));
    if (removed.length) await tx.delete(customerTag).where(and(eq(customerTag.customerId, input.customerId), inArray(customerTag.tagCode, removed)));
    const added = input.tags.filter((t) => !current.some((c) => c.tagCode === t));
    if (added.length) {
      await tx.insert(customerTag).values(added.map((tagCode) => ({ customerId: input.customerId, tagCode, createdBy: actor.id, updatedBy: actor.id })));
    }
  });
}

/** 상담원 공유 내부 메모 */
export async function updateCustomerMemo(input: z.output<typeof customerMemoInput>, filter: BranchFilter, actor: Actor) {
  await assertCustomerInScope(input.customerId, filter);
  await getDb()
    .update(customer)
    .set({ memo: input.memo, updatedAt: new Date(), updatedBy: actor.id })
    .where(eq(customer.id, input.customerId));
}

