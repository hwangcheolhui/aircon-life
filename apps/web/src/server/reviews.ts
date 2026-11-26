import 'server-only';
/**
 * 후기 (단계 9): 고객 후기 작성 C-REV-010(F-CUS-REV-01), 관리자 후기 관리 A-VOC-040(F-ADM-VOC-04), 후기 요청 배치(F-SYS-05).
 * - 작업 완료(WORK_DONE·COMPLETED) 후 REVIEW_WRITABLE_DAYS 일 안에 주문당 1건, AS 재방문 주문은 제외
 * - BR-090 평점 ≤ REVIEW_VOC_MAX_RATING(기본 2) 이면 VOC(채널 REVIEW, 불만)를 자동 생성해 review.voc_id 로 연결
 * - 기사 평균 평점(technician.rating_avg)은 숨기지 않은 후기로 다시 계산한다
 */
import type { reviewAdminInput, reviewInput, z } from '@aircon/contracts';
import { customer, review, serviceOrder, technician, voc } from '@aircon/db';
import {
  type BranchFilter,
  REVIEW_PHOTO_MAX,
  SETTING_KEYS,
  checkReviewInput,
  isReviewRequestDue,
  joinTags,
  lowRatingSeverity,
  lowRatingVocText,
  maskName,
  needsLowRatingVoc,
  parseTags,
  reviewWindow,
} from '@aircon/domain';
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { formatDate } from '@/customer/format';
import { UserError, ValidationFailed } from './action-result';
import { saveAttachment } from './attachments';
import { loadCodes } from './codes';
import { getDb } from './db';
import { alreadyNotified, notifyCustomer } from './notify';
import { type Tx, isUniqueViolation } from './orders';
import { decrypt } from './pii';
import { getSettingNumber } from './settings';
import { assertInScope, insertVocInTx, mainTechOf, scopeCond } from './voc';

type Db = ReturnType<typeof getDb>;

async function myOrder(customerId: number, orderNo: string) {
  const [o] = await getDb()
    .select()
    .from(serviceOrder)
    .where(and(eq(serviceOrder.orderNo, orderNo), eq(serviceOrder.customerId, customerId)));
  return o ?? null;
}

/** C-REV-010 화면: 작성 가능 여부·기존 후기 */
export async function customerReviewInfo(customerId: number, orderNo: string, now = new Date()) {
  const o = await myOrder(customerId, orderNo);
  if (!o) return null;
  const [mine] = await getDb().select().from(review).where(eq(review.orderId, o.id));
  const writableDays = await getSettingNumber(SETTING_KEYS.REVIEW_WRITABLE_DAYS);
  const win = reviewWindow({ orderStatus: o.status, orderType: o.orderType, completedAt: o.completedAt, hasReview: Boolean(mine), now, writableDays });
  return {
    orderNo: o.orderNo,
    window: win.ok ? { ok: true as const, until: formatDate(win.until) } : win,
    review: mine
      ? {
          rating: mine.rating,
          npsScore: mine.npsScore,
          tags: parseTags(mine.tags),
          content: mine.content,
          photoIds: (mine.photoFileIds ?? '').split(',').filter(Boolean).map(Number),
          adminReply: mine.isHidden ? null : mine.adminReply,
          createdAt: mine.createdAt,
        }
      : null,
  };
}

/** 기사 평균 평점 갱신 (숨김 제외) */
export async function refreshTechRating(tx: Tx | Db, techId: number) {
  await tx.execute(
    sql`update technician set rating_avg = (select round(avg(rating)::numeric, 2) from review where technician_id = ${techId} and is_hidden = false) where id = ${techId}`,
  );
}

/** F-CUS-REV-01 후기 등록 (+ BR-090 저평점 VOC) */
export async function submitReview(customerId: number, input: z.output<typeof reviewInput>, files: File[], now = new Date()) {
  const db = getDb();
  const o = await myOrder(customerId, input.orderNo);
  if (!o) throw new UserError('예약을 찾을 수 없어요.');
  const [existing] = await db.select({ id: review.id }).from(review).where(eq(review.orderId, o.id));
  const [writableDays, maxVocRating, codes] = await Promise.all([
    getSettingNumber(SETTING_KEYS.REVIEW_WRITABLE_DAYS),
    getSettingNumber(SETTING_KEYS.REVIEW_VOC_MAX_RATING),
    loadCodes(['REVIEW_TAG']),
  ]);
  const win = reviewWindow({ orderStatus: o.status, orderType: o.orderType, completedAt: o.completedAt, hasReview: Boolean(existing), now, writableDays });
  if (!win.ok) throw new UserError(win.reason);
  const e = checkReviewInput({
    rating: input.rating,
    npsScore: input.npsScore,
    tags: input.tags,
    allowedTags: (codes.REVIEW_TAG ?? []).map((c) => c.value),
    content: input.content ?? '',
    photoCount: files.length,
  });
  if (Object.keys(e).length) throw new ValidationFailed(e);
  for (const f of files) {
    if (!f.type.startsWith('image/')) throw new UserError('사진 파일만 올릴 수 있어요.');
    if (f.size > 4 * 1024 * 1024) throw new UserError('사진은 4MB 이하로 올려 주세요.');
  }
  const techId = await mainTechOf(db, o.id);
  if (!techId) throw new UserError('작업 기사를 찾을 수 없어 후기를 남길 수 없어요. 고객센터로 문의해 주세요.');
  const rating = input.rating!;
  const actor = { type: 'CUSTOMER' as const, id: customerId };
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(review)
          .values({
            orderId: o.id,
            customerId,
            technicianId: techId,
            branchId: o.branchId,
            rating,
            npsScore: input.npsScore,
            tags: joinTags(input.tags),
            content: input.content,
            createdBy: customerId,
            updatedBy: customerId,
          })
          .returning({ id: review.id });
        const ids: number[] = [];
        for (const f of files.slice(0, REVIEW_PHOTO_MAX)) ids.push((await saveAttachment(f, 'REVIEW', row!.id, actor, tx)).id);
        let vocNo: string | null = null;
        let vocId: number | null = null;
        if (needsLowRatingVoc(rating, maxVocRating)) {
          const text = lowRatingVocText({ orderNo: o.orderNo, rating, tags: input.tags, content: input.content ?? '' });
          const v = await insertVocInTx(
            tx,
            now,
            attempt,
            {
              consultationId: null,
              customerId,
              orderId: o.id,
              channel: 'REVIEW',
              vocType: 'COMPLAINT',
              title: text.title,
              content: text.content,
              severity: lowRatingSeverity(rating),
            },
            actor,
          );
          vocNo = v.vocNo;
          vocId = v.id;
        }
        await tx
          .update(review)
          .set({ photoFileIds: ids.length ? ids.join(',') : null, vocId })
          .where(eq(review.id, row!.id));
        await refreshTechRating(tx, techId);
        return { id: row!.id, vocNo };
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) {
        const [dup] = await db.select({ id: review.id }).from(review).where(eq(review.orderId, o.id));
        if (dup) throw new UserError('이미 후기를 남긴 예약이에요.');
        continue; // VOC 번호 충돌
      }
      throw err;
    }
  }
}

/* ---------- A-VOC-040 후기 관리 ---------- */

export async function listReviews(filter: BranchFilter, q: { from: string | null; to: string | null; maxRating: number | null; techId: number | null }) {
  const rows = await getDb()
    .select({ r: review, orderNo: serviceOrder.orderNo, customerName: customer.name, techName: technician.name, vocNo: voc.vocNo })
    .from(review)
    .innerJoin(serviceOrder, eq(serviceOrder.id, review.orderId))
    .innerJoin(customer, eq(customer.id, review.customerId))
    .innerJoin(technician, eq(technician.id, review.technicianId))
    .leftJoin(voc, eq(voc.id, review.vocId))
    .where(
      and(
        scopeCond(filter, review.branchId),
        q.from ? gte(review.createdAt, new Date(`${q.from}T00:00:00+09:00`)) : undefined,
        q.to ? lte(review.createdAt, new Date(`${q.to}T23:59:59.999+09:00`)) : undefined,
        q.maxRating ? lte(review.rating, q.maxRating) : undefined,
        q.techId ? eq(review.technicianId, q.techId) : undefined,
      ),
    )
    .orderBy(desc(review.createdAt))
    .limit(500);
  return rows.map((x) => ({
    id: x.r.id,
    orderNo: x.orderNo,
    customerName: maskName(decrypt(x.customerName)),
    techName: x.techName,
    rating: x.r.rating,
    npsScore: x.r.npsScore,
    tags: parseTags(x.r.tags),
    content: x.r.content,
    photoIds: (x.r.photoFileIds ?? '').split(',').filter(Boolean).map(Number),
    adminReply: x.r.adminReply,
    isHidden: x.r.isHidden,
    vocId: x.r.vocId,
    vocNo: x.vocNo,
    createdAt: x.r.createdAt,
  }));
}

/** F-ADM-VOC-04 답글·숨김. 숨기면 평균 평점에서 뺀다 */
export async function updateReviewAdmin(input: z.output<typeof reviewAdminInput>, filter: BranchFilter, adminId: number, now = new Date()) {
  const db = getDb();
  const [r] = await db.select().from(review).where(eq(review.id, input.id));
  if (!r) throw new UserError('후기를 찾을 수 없습니다.');
  assertInScope(filter, r.branchId);
  await db.transaction(async (tx) => {
    await tx
      .update(review)
      .set({
        adminReply: input.adminReply,
        repliedAt: input.adminReply && input.adminReply !== r.adminReply ? now : r.repliedAt,
        isHidden: input.isHidden,
        updatedAt: now,
        updatedBy: adminId,
      })
      .where(eq(review.id, r.id));
    if (input.isHidden !== r.isHidden) await refreshTechRating(tx, r.technicianId);
  });
}

/** 고객이 남긴 후기 사진인지 (파일 권한) */
export async function reviewOwnerOf(reviewId: number) {
  const [r] = await getDb().select({ customerId: review.customerId, branchId: review.branchId }).from(review).where(eq(review.id, reviewId));
  return r ?? null;
}

/** KPI NPS 입력: 기간 안 후기의 추천의향 점수 */
export async function npsScoresBetween(from: Date, to: Date, branchId: number | null) {
  const rows = await getDb()
    .select({ s: review.npsScore })
    .from(review)
    .where(
      and(isNotNull(review.npsScore), gte(review.createdAt, from), lte(review.createdAt, to), eq(review.isHidden, false), branchId ? eq(review.branchId, branchId) : undefined),
    );
  return rows.map((r) => r.s!);
}

/**
 * F-SYS-05 후기 요청 배치(매일): 완료 후 REVIEW_REQUEST_DELAY_HOURS 가 지났고 작성 기한이 남은 주문 중
 * 후기가 없고 아직 요청하지 않은 건에 REVIEW_REQUEST 를 보낸다. Vercel Hobby 는 하루 1회라 "2시간 뒤" 는 "다음 실행 때" 가 된다.
 */
export async function runReviewRequests(origin: string, now = new Date()) {
  const db = getDb();
  const [delayHours, writableDays] = await Promise.all([
    getSettingNumber(SETTING_KEYS.REVIEW_REQUEST_DELAY_HOURS),
    getSettingNumber(SETTING_KEYS.REVIEW_WRITABLE_DAYS),
  ]);
  const since = new Date(now.getTime() - writableDays * 86_400_000);
  const rows = await db
    .select({ id: serviceOrder.id, orderNo: serviceOrder.orderNo, customerId: serviceOrder.customerId, completedAt: serviceOrder.completedAt, rid: review.id })
    .from(serviceOrder)
    .leftJoin(review, eq(review.orderId, serviceOrder.id))
    .where(
      and(
        inArray(serviceOrder.status, ['WORK_DONE', 'COMPLETED']),
        eq(serviceOrder.orderType, 'NORMAL'),
        gte(serviceOrder.completedAt, since),
        lte(serviceOrder.completedAt, now),
      ),
    )
    .limit(2000);
  let sent = 0;
  for (const r of rows) {
    if (!r.completedAt) continue;
    const due = isReviewRequestDue({ completedAt: r.completedAt, now, delayHours, writableDays, hasReview: r.rid !== null, alreadyRequested: false });
    if (!due || (await alreadyNotified('REVIEW_REQUEST', r.id))) continue;
    const until = new Date(r.completedAt.getTime() + writableDays * 86_400_000);
    const status = await notifyCustomer('REVIEW_REQUEST', r.customerId, { 접수번호: r.orderNo, 마감일: formatDate(until), 후기링크: `${origin}/orders/${r.orderNo}/review` }, { type: 'ORDER', id: r.id });
    if (status !== 'SKIPPED') sent++;
  }
  return { targets: rows.length, sent };
}
