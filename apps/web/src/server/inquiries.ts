import 'server-only';
/**
 * 1:1 문의 서버 서비스 (단계 8-1): F-CUS-CS-02(C-CS-020) · A-CSL-080 답변.
 * 문의는 상담(consultation) channel=APP_CHAT, consult_type=INQUIRY, status=OPEN 으로 만들고,
 * 답변하면 reply_content·replied_at 을 채우고 OPEN → DONE(01 §3.5) + 고객 알림(INQUIRY_ANSWERED).
 * VOC 전환(불만 문의)·FAQ 전환(F-ADM-CNT-02)을 여기서 한다.
 */
import type { customerInquiryInput, inquiryReplyInput, z } from '@aircon/contracts';
import { adminUser, consultation, customer, faq, serviceOrder } from '@aircon/db';
import { type BranchFilter, assertConsultTransition, maskName } from '@aircon/domain';
import { and, desc, eq } from 'drizzle-orm';
import { UserError } from './action-result';
import { customerScopeCond, insertConsultation } from './consult';
import { getDb } from './db';
import { notifyCustomer } from './notify';
import { type Actor, isUniqueViolation } from './orders';
import { decrypt } from './pii';
import { insertVocInTx } from './voc';

export const INQUIRY_CHANNEL = 'APP_CHAT';

/** C-CS-020 내 문의 목록 */
export async function listCustomerInquiries(customerId: number) {
  return getDb()
    .select({
      id: consultation.id,
      consultNo: consultation.consultNo,
      subType: consultation.subType,
      content: consultation.content,
      status: consultation.status,
      replyContent: consultation.replyContent,
      repliedAt: consultation.repliedAt,
      createdAt: consultation.createdAt,
      orderNo: serviceOrder.orderNo,
    })
    .from(consultation)
    .leftJoin(serviceOrder, eq(serviceOrder.id, consultation.relatedOrderId))
    .where(and(eq(consultation.customerId, customerId), eq(consultation.channel, INQUIRY_CHANNEL)))
    .orderBy(desc(consultation.createdAt))
    .limit(100);
}

/** F-CUS-CS-02 문의 등록 */
export async function createCustomerInquiry(customerId: number, input: z.output<typeof customerInquiryInput>, now = new Date()) {
  const db = getDb();
  let orderId: number | null = null;
  if (input.orderNo) {
    const [o] = await db.select({ id: serviceOrder.id }).from(serviceOrder).where(and(eq(serviceOrder.orderNo, input.orderNo), eq(serviceOrder.customerId, customerId)));
    if (!o) throw new UserError('예약을 찾을 수 없어요.');
    orderId = o.id;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction((tx) =>
        insertConsultation(
          tx,
          now,
          attempt,
          { customerId, callLogId: null, consultType: 'INQUIRY', subType: input.subType, relatedOrderId: orderId, content: input.content, status: 'OPEN', channel: INQUIRY_CHANNEL },
          { type: 'CUSTOMER', id: customerId },
        ),
      );
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) continue;
      throw e;
    }
  }
}

/** A-CSL-080 앱 문의 목록 (고객 이름 마스킹, 거점 범위 = 고객 주소 거점) */
export async function listInquiries(filter: BranchFilter, status: 'OPEN' | 'DONE' | null) {
  const rows = await getDb()
    .select({ c: consultation, customerName: customer.name, customerNo: customer.customerNo, orderNo: serviceOrder.orderNo, replierName: adminUser.name })
    .from(consultation)
    .innerJoin(customer, eq(customer.id, consultation.customerId))
    .leftJoin(serviceOrder, eq(serviceOrder.id, consultation.relatedOrderId))
    .leftJoin(adminUser, eq(adminUser.id, consultation.repliedBy))
    .where(
      and(
        eq(consultation.channel, INQUIRY_CHANNEL),
        customerScopeCond(filter),
        status === 'OPEN' ? eq(consultation.status, 'OPEN') : status === 'DONE' ? eq(consultation.status, 'DONE') : undefined,
      ),
    )
    .orderBy(desc(consultation.createdAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.c.id,
    consultNo: r.c.consultNo,
    subType: r.c.subType,
    content: r.c.content,
    status: r.c.status,
    replyContent: r.c.replyContent,
    repliedAt: r.c.repliedAt,
    replierName: r.replierName,
    createdAt: r.c.createdAt,
    orderNo: r.orderNo,
    customerNo: r.customerNo,
    customerName: maskName(decrypt(r.customerName)),
  }));
}

async function loadInquiry(id: number, filter: BranchFilter) {
  const [r] = await getDb()
    .select({ c: consultation })
    .from(consultation)
    .innerJoin(customer, eq(customer.id, consultation.customerId))
    .where(and(eq(consultation.id, id), eq(consultation.channel, INQUIRY_CHANNEL), customerScopeCond(filter)));
  if (!r) throw new UserError('문의를 찾을 수 없거나 조회 권한이 없습니다.');
  return r.c;
}

/** A-CSL-080 답변 → 완료 + 고객 알림 */
export async function replyInquiry(input: z.output<typeof inquiryReplyInput>, filter: BranchFilter, actor: Actor, now = new Date()) {
  const c = await loadInquiry(input.id, filter);
  assertConsultTransition(c.status, 'DONE');
  const done = await getDb()
    .update(consultation)
    .set({ replyContent: input.reply, repliedAt: now, repliedBy: actor.id, status: 'DONE', completedAt: now, updatedAt: now, updatedBy: actor.id })
    .where(and(eq(consultation.id, c.id), eq(consultation.status, c.status)))
    .returning({ id: consultation.id });
  if (done.length === 0) throw new UserError('다른 곳에서 먼저 답변한 문의입니다.');
  await notifyCustomer('INQUIRY_ANSWERED', c.customerId!, {}, { type: 'CONSULT', id: c.id });
}

/** 불만 문의 → VOC(접수 매체 APP) */
export async function inquiryToVoc(id: number, filter: BranchFilter, actor: Actor, now = new Date()) {
  const c = await loadInquiry(id, filter);
  for (let attempt = 0; ; attempt++) {
    try {
      return await getDb().transaction((tx) =>
        insertVocInTx(
          tx,
          now,
          attempt,
          { consultationId: c.id, customerId: c.customerId!, orderId: c.relatedOrderId, channel: 'APP', vocType: 'COMPLAINT', subType: c.subType, content: c.content ?? '' },
          actor,
        ),
      );
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) continue;
      throw e;
    }
  }
}

/** F-ADM-CNT-02 상담 → FAQ 전환: 질문 = 문의 내용, 답변 = 답변 내용, 게시 안 함(검토 후 A-CNT-020에서 게시) */
export async function inquiryToFaq(id: number, filter: BranchFilter, actor: Actor) {
  const c = await loadInquiry(id, filter);
  if (!c.replyContent) throw new UserError('답변한 문의만 FAQ로 만들 수 있습니다.');
  const category = c.subType === 'PRICE' || c.subType === 'EXTRA_CHARGE' ? 'PRICE' : c.subType === 'SCHEDULE' || c.subType === 'DELAY' ? 'RESERVATION' : c.subType === 'SERVICE' ? 'SERVICE' : 'ETC';
  const [row] = await getDb()
    .insert(faq)
    .values({
      category,
      audience: 'CUSTOMER',
      question: (c.content ?? '').slice(0, 300),
      answer: c.replyContent,
      sourceConsultationId: c.id,
      isPublished: false,
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning({ id: faq.id });
  return row!;
}
