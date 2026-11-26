import 'server-only';
/**
 * 고객 알림 발송 + 발송 이력 (F-SYS-03, 접수·변경·취소 알림, 01 §2.12). 알림톡 실패 시 문자로 대체하고 결과를 notification_log 에 남긴다.
 * 발송 실패가 예약 처리를 막지 않도록 오류는 이력(FAILED)으로만 남긴다.
 */
import { branch, notificationLog, notificationTemplate, serviceOrder } from '@aircon/db';
import { type NotificationTemplateCode, maskPhone, renderTemplate } from '@aircon/domain';
import { createNotifyTransport, createPushSender, sendWithFallback } from '@aircon/integrations';
import { and, eq } from 'drizzle-orm';
import { formatVisit } from '@/customer/format';
import { getCustomerContact } from './customers';
import { getDb, isDbConfigured } from './db';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 주문 관련 고객 알림 1건 발송. extra 는 템플릿 치환 변수 추가분(예: 기사명) */
export async function notifyOrder(code: NotificationTemplateCode, orderId: number, extra: Record<string, string> = {}): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  try {
    const [t] = await db.select().from(notificationTemplate).where(eq(notificationTemplate.templateCode, code));
    if (!t || !t.isActive) return;
    const [o] = await db
      .select({ order: serviceOrder, branchPhone: branch.phone })
      .from(serviceOrder)
      .innerJoin(branch, eq(branch.id, serviceOrder.branchId))
      .where(eq(serviceOrder.id, orderId));
    if (!o) return;
    const contact = await getCustomerContact(o.order.customerId);
    if (!contact?.phone) return;
    const vars: Record<string, string> = {
      고객명: contact.name,
      접수번호: o.order.orderNo,
      방문일시: o.order.promisedAt ? formatVisit(o.order.promisedAt) : '',
      금액: won(o.order.totalAmount),
      거점전화: o.branchPhone ?? '',
      ...extra,
    };
    const text = renderTemplate(t.body, vars);
    const preferred = t.channel === 'ALIMTALK' ? 'ALIMTALK' : 'SMS';
    const outcome = await sendWithFallback(
      createNotifyTransport(),
      {
        to: contact.phone,
        text,
        title: t.title,
        kakaoTemplateId: t.kakaoTemplateId ?? undefined,
        variables: Object.fromEntries(Object.entries(vars).map(([k, v]) => [`#{${k}}`, v])),
      },
      preferred,
    ).catch((e: Error) => ({ status: 'FAILED' as const, channel: null, failReason: e.message }));
    await db.insert(notificationLog).values({
      templateId: t.id,
      receiverType: 'CUSTOMER',
      receiverId: o.order.customerId,
      receiverPhoneMasked: maskPhone(contact.phone),
      // 둘 다 실패하면 처음 시도한 채널로 남긴다
      channel: outcome.channel ?? preferred,
      relatedType: 'ORDER',
      relatedId: orderId,
      status: outcome.status,
      sentAt: outcome.status === 'FAILED' ? null : new Date(),
      failReason: outcome.failReason?.slice(0, 300) ?? null,
    });
  } catch (e) {
    console.error('알림 발송 실패', code, orderId, e);
  }
}

/**
 * 기사·운영자 앱 알림 (단계 4-1: 신규 배정·배정 변경·이관 반려 → 기사 알림함 T-NTF-010, F-SYS-09 미지정 경고 → 운영자).
 * notification_log(channel=PUSH)에 남기고 앱 푸시 어댑터로 보낸다. 실패해도 업무 처리는 막지 않는다.
 * 기사 알림은 receiver_id = 기사 ID, 운영자 경고는 거점 단위라 receiver_id 없이 related(주문)로 남긴다.
 */
export async function notifyStaff(
  code: NotificationTemplateCode,
  receiver: { type: 'TECHNICIAN'; id: number } | { type: 'ADMIN'; id: null },
  orderId: number,
  link?: string,
): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  try {
    const [t] = await db.select().from(notificationTemplate).where(eq(notificationTemplate.templateCode, code));
    if (!t || !t.isActive) return;
    const [o] = await db.select().from(serviceOrder).where(eq(serviceOrder.id, orderId));
    if (!o) return;
    const text = renderTemplate(t.body, { 접수번호: o.orderNo, 방문일시: o.promisedAt ? formatVisit(o.promisedAt) : '', 금액: won(o.totalAmount) });
    const r = await createPushSender()
      .send({ receiverType: receiver.type, receiverId: receiver.id ?? 0, title: t.title, body: text, link })
      .catch((e: Error) => ({ ok: false, failReason: e.message }));
    await db.insert(notificationLog).values({
      templateId: t.id,
      receiverType: receiver.type,
      receiverId: receiver.id,
      channel: 'PUSH',
      relatedType: 'ORDER',
      relatedId: orderId,
      status: r.ok ? 'SENT' : 'FAILED',
      sentAt: r.ok ? new Date() : null,
      failReason: r.failReason?.slice(0, 300) ?? null,
    });
  } catch (e) {
    console.error('앱 알림 발송 실패', code, orderId, e);
  }
}

/**
 * 기사·운영자 앱 알림 — 주문이 아닌 대상(코스 등)이나 치환 변수를 직접 넘길 때 (단계 4-2: 코스 초안·마감 임박·자동 확정, 자가 배정).
 * related 는 notification_log.related_type/related_id (예: ROUTE_PLAN, ORDER).
 */
export async function notifyStaffWith(
  code: NotificationTemplateCode,
  receiver: { type: 'TECHNICIAN'; id: number } | { type: 'ADMIN'; id: number | null },
  related: { type: 'ORDER' | 'ROUTE_PLAN' | 'SETTLEMENT' | 'FOLLOWUP' | 'INCIDENT'; id: number },
  vars: Record<string, string>,
  link?: string,
): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  try {
    const [t] = await db.select().from(notificationTemplate).where(eq(notificationTemplate.templateCode, code));
    if (!t || !t.isActive) return;
    const r = await createPushSender()
      .send({ receiverType: receiver.type, receiverId: receiver.id ?? 0, title: t.title, body: renderTemplate(t.body, vars), link })
      .catch((e: Error) => ({ ok: false, failReason: e.message }));
    await db.insert(notificationLog).values({
      templateId: t.id,
      receiverType: receiver.type,
      receiverId: receiver.id,
      channel: 'PUSH',
      relatedType: related.type,
      relatedId: related.id,
      status: r.ok ? 'SENT' : 'FAILED',
      sentAt: r.ok ? new Date() : null,
      failReason: r.failReason?.slice(0, 300) ?? null,
    });
  } catch (e) {
    console.error('앱 알림 발송 실패', code, related, e);
  }
}

/** 같은 대상에 이 템플릿 알림을 이미 남겼는지 (코스 배치 중복 알림 방지) */
export async function alreadyNotifiedRelated(code: NotificationTemplateCode, relatedType: string, relatedId: number): Promise<boolean> {
  const db = getDb();
  const [t] = await db.select({ id: notificationTemplate.id }).from(notificationTemplate).where(eq(notificationTemplate.templateCode, code));
  if (!t) return true;
  const [hit] = await db
    .select({ id: notificationLog.id })
    .from(notificationLog)
    .where(and(eq(notificationLog.templateId, t.id), eq(notificationLog.relatedType, relatedType), eq(notificationLog.relatedId, relatedId)))
    .limit(1);
  return Boolean(hit);
}

/** 같은 주문에 이 템플릿 알림을 이미 남겼는지 (F-SYS-09 중복 경고 방지) */
export async function alreadyNotified(code: NotificationTemplateCode, orderId: number): Promise<boolean> {
  const db = getDb();
  const [t] = await db.select({ id: notificationTemplate.id }).from(notificationTemplate).where(eq(notificationTemplate.templateCode, code));
  if (!t) return true;
  const [hit] = await db
    .select({ id: notificationLog.id })
    .from(notificationLog)
    .where(and(eq(notificationLog.templateId, t.id), eq(notificationLog.relatedType, 'ORDER'), eq(notificationLog.relatedId, orderId)))
    .limit(1);
  return Boolean(hit);
}

/**
 * 고객 알림 — 주문이 없거나 치환 변수를 직접 넘길 때 (단계 8: 1:1 문의 답변·재방문 캠페인).
 * 고객명·거점전화는 자동으로 채운다. 결과는 notification_log 에 남기고 상태를 돌려준다(캠페인 대상 성과용).
 */
export async function notifyCustomer(
  code: NotificationTemplateCode,
  customerId: number,
  vars: Record<string, string>,
  related: { type: 'ORDER' | 'CAMPAIGN' | 'CONSULT' | 'AS'; id: number },
): Promise<'SENT' | 'FALLBACK_SMS' | 'FAILED' | 'SKIPPED'> {
  if (!isDbConfigured()) return 'SKIPPED';
  const db = getDb();
  try {
    const [t] = await db.select().from(notificationTemplate).where(eq(notificationTemplate.templateCode, code));
    if (!t || !t.isActive) return 'SKIPPED';
    const contact = await getCustomerContact(customerId);
    if (!contact?.phone) return 'SKIPPED';
    const all: Record<string, string> = { 고객명: contact.name, ...vars };
    const preferred = t.channel === 'ALIMTALK' ? 'ALIMTALK' : 'SMS';
    const outcome = await sendWithFallback(
      createNotifyTransport(),
      {
        to: contact.phone,
        text: renderTemplate(t.body, all),
        title: t.title,
        kakaoTemplateId: t.kakaoTemplateId ?? undefined,
        variables: Object.fromEntries(Object.entries(all).map(([k, v]) => [`#{${k}}`, v])),
      },
      preferred,
    ).catch((e: Error) => ({ status: 'FAILED' as const, channel: null, failReason: e.message }));
    await db.insert(notificationLog).values({
      templateId: t.id,
      receiverType: 'CUSTOMER',
      receiverId: customerId,
      receiverPhoneMasked: maskPhone(contact.phone),
      channel: outcome.channel ?? preferred,
      relatedType: related.type,
      relatedId: related.id,
      status: outcome.status,
      sentAt: outcome.status === 'FAILED' ? null : new Date(),
      failReason: outcome.failReason?.slice(0, 300) ?? null,
    });
    return outcome.status as 'SENT' | 'FALLBACK_SMS' | 'FAILED';
  } catch (e) {
    console.error('고객 알림 발송 실패', code, customerId, e);
    return 'FAILED';
  }
}

/** 외부 수신자 문자 (단계 8 안전사고 수동 수신자). 템플릿 본문을 그대로 문자로 보낸다 */
export async function notifyPhone(code: NotificationTemplateCode, phone: string, vars: Record<string, string>, related: { type: 'INCIDENT'; id: number }) {
  if (!isDbConfigured()) return 'SKIPPED' as const;
  const db = getDb();
  try {
    const [t] = await db.select().from(notificationTemplate).where(eq(notificationTemplate.templateCode, code));
    if (!t || !t.isActive) return 'SKIPPED' as const;
    const outcome = await sendWithFallback(createNotifyTransport(), { to: phone, text: renderTemplate(t.body, vars), title: t.title }, 'SMS').catch((e: Error) => ({
      status: 'FAILED' as const,
      channel: null,
      failReason: e.message,
    }));
    await db.insert(notificationLog).values({
      templateId: t.id,
      receiverType: 'ADMIN',
      receiverId: null,
      receiverPhoneMasked: maskPhone(phone),
      channel: outcome.channel ?? 'SMS',
      relatedType: related.type,
      relatedId: related.id,
      status: outcome.status,
      sentAt: outcome.status === 'FAILED' ? null : new Date(),
      failReason: outcome.failReason?.slice(0, 300) ?? null,
    });
    return outcome.status;
  } catch (e) {
    console.error('문자 발송 실패', code, e);
    return 'FAILED' as const;
  }
}
