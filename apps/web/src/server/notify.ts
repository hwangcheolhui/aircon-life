import 'server-only';
/**
 * 고객 알림 발송 + 발송 이력 (F-SYS-03, 접수·변경·취소 알림, 01 §2.12). 알림톡 실패 시 문자로 대체하고 결과를 notification_log 에 남긴다.
 * 발송 실패가 예약 처리를 막지 않도록 오류는 이력(FAILED)으로만 남긴다.
 */
import { branch, notificationLog, notificationTemplate, serviceOrder } from '@aircon/db';
import { type NotificationTemplateCode, maskPhone, renderTemplate } from '@aircon/domain';
import { createNotifyTransport, sendWithFallback } from '@aircon/integrations';
import { eq } from 'drizzle-orm';
import { formatVisit } from '@/customer/format';
import { getCustomerContact } from './customers';
import { getDb, isDbConfigured } from './db';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 주문 관련 고객 알림 1건 발송 */
export async function notifyOrder(code: NotificationTemplateCode, orderId: number): Promise<void> {
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
    };
    const text = renderTemplate(t.body, vars);
    const outcome = await sendWithFallback(
      createNotifyTransport(),
      {
        to: contact.phone,
        text,
        title: t.title,
        kakaoTemplateId: t.kakaoTemplateId,
        variables: Object.fromEntries(Object.entries(vars).map(([k, v]) => [`#{${k}}`, v])),
      },
      t.channel === 'ALIMTALK' ? 'ALIMTALK' : 'SMS',
    ).catch((e: Error) => ({ status: 'FAILED' as const, channel: 'SMS' as const, failReason: e.message }));
    await db.insert(notificationLog).values({
      templateId: t.id,
      receiverType: 'CUSTOMER',
      receiverId: o.order.customerId,
      receiverPhoneMasked: maskPhone(contact.phone),
      channel: outcome.channel,
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
