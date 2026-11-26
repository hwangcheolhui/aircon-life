import 'server-only';
/**
 * 콘텐츠 서버 서비스 (단계 8-2): 공지 F-ADM-CNT-01(A-CNT-010) · F-TEC-HOM-01(T-HOM-010·T-NTC-010), FAQ F-ADM-CNT-02(A-CNT-020) · C-CS-010.
 * - 공지 노출은 domain noticeVisibleTo(게시 기간·대상·거점), 작성 범위는 canWriteNotice(BR-102).
 * - 읽음(필독 확인)은 notice_read 에 1행(같은 사람은 한 번).
 */
import type { faqInput, noticeInput, z } from '@aircon/contracts';
import { adminUser, branch, faq, notice, noticeRead, technician } from '@aircon/db';
import { type BranchFilter, canWriteNotice, noticeVisibleTo, sortNotices } from '@aircon/domain';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { UserError } from './action-result';
import { getDb } from './db';
import type { Actor } from './orders';

const dayStart = (d: string) => new Date(`${d}T00:00:00+09:00`);
const dayEnd = (d: string) => new Date(`${d}T23:59:59+09:00`);
const kstDay = (d: Date | null) => (d ? d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : null);

/* ---------- 공지 (A-CNT-010) ---------- */

/** 공지 목록 + 읽음 현황(기사 대상 공지: 읽은 기사 수 / 대상 기사 수) */
export async function listNotices(filter: BranchFilter) {
  const db = getDb();
  const rows = await db
    .select({ n: notice, branchName: branch.name, authorName: adminUser.name })
    .from(notice)
    .leftJoin(branch, eq(branch.id, notice.branchId))
    .leftJoin(adminUser, eq(adminUser.id, notice.authorAdminId))
    .where(
      and(
        isNull(notice.deletedAt),
        filter.kind === 'ALL' ? undefined : filter.kind === 'NONE' ? sql`false` : sql`(${notice.branchId} is null or ${notice.branchId} = ${filter.branchId})`,
      ),
    )
    .orderBy(desc(notice.isPinned), desc(notice.publishFrom))
    .limit(300);
  const ids = rows.map((r) => r.n.id);
  const reads = ids.length
    ? await db
        .select({ noticeId: noticeRead.noticeId, n: sql<number>`count(*)::int` })
        .from(noticeRead)
        .where(and(inArray(noticeRead.noticeId, ids), eq(noticeRead.readerType, 'TECHNICIAN')))
        .groupBy(noticeRead.noticeId)
    : [];
  const techs = await db
    .select({ branchId: technician.branchId, n: sql<number>`count(*)::int` })
    .from(technician)
    .where(and(isNull(technician.deletedAt), inArray(technician.status, ['ACTIVE', 'TRAINING', 'PAUSED'])))
    .groupBy(technician.branchId);
  const allTechs = techs.reduce((s, t) => s + t.n, 0);
  return rows.map((r) => {
    const forTech = r.n.targetAudience === 'TECHNICIAN' || r.n.targetAudience === 'ALL';
    return {
      ...r.n,
      publishFrom: kstDay(r.n.publishFrom),
      publishTo: kstDay(r.n.publishTo),
      branchName: r.branchName,
      authorName: r.authorName,
      readCount: reads.find((x) => x.noticeId === r.n.id)?.n ?? 0,
      targetCount: !forTech || r.n.noticeType === 'CUSTOMER' ? null : r.n.noticeType === 'BRANCH' ? (techs.find((t) => t.branchId === r.n.branchId)?.n ?? 0) : allTechs,
    };
  });
}

/** 공지 저장 (등록·수정). 작성 범위는 역할 범위로 판단한다(상단 거점 선택과 무관, BR-102) */
export async function saveNotice(input: z.output<typeof noticeInput>, scope: BranchFilter, actor: Actor, now = new Date()) {
  const branchId = input.noticeType === 'BRANCH' ? input.branchId : null;
  const err = canWriteNotice(scope, { noticeType: input.noticeType, branchId });
  if (err) throw new UserError(err);
  const audience = input.noticeType === 'CUSTOMER' ? 'CUSTOMER' : input.targetAudience;
  const values = {
    noticeType: input.noticeType,
    targetAudience: audience,
    branchId,
    title: input.title,
    content: input.content,
    isPinned: input.isPinned,
    isPopup: input.isPopup,
    publishFrom: dayStart(input.publishFrom),
    publishTo: input.publishTo ? dayEnd(input.publishTo) : null,
    updatedAt: now,
    updatedBy: actor.id,
  };
  const db = getDb();
  if (input.id) {
    const [n] = await db.select().from(notice).where(and(eq(notice.id, input.id), isNull(notice.deletedAt)));
    if (!n) throw new UserError('공지를 찾을 수 없습니다.');
    const e2 = canWriteNotice(scope, { noticeType: n.noticeType, branchId: n.branchId });
    if (e2) throw new UserError(e2);
    await db.update(notice).set(values).where(eq(notice.id, n.id));
    return n.id;
  }
  const [row] = await db
    .insert(notice)
    .values({ ...values, authorAdminId: actor.id, createdBy: actor.id })
    .returning({ id: notice.id });
  return row!.id;
}

export async function deleteNotice(id: number, scope: BranchFilter, actor: Actor, now = new Date()) {
  const db = getDb();
  const [n] = await db.select().from(notice).where(and(eq(notice.id, id), isNull(notice.deletedAt)));
  if (!n) throw new UserError('공지를 찾을 수 없습니다.');
  const err = canWriteNotice(scope, { noticeType: n.noticeType, branchId: n.branchId });
  if (err) throw new UserError(err);
  await db.update(notice).set({ deletedAt: now, updatedAt: now, updatedBy: actor.id }).where(eq(notice.id, id));
}

/* ---------- 기사 앱 공지 (T-HOM-010 주요 공지 3건, T-NTC-010) ---------- */

export async function techNotices(tech: { id: number; branchId: number }, now = new Date()) {
  const db = getDb();
  const rows = await db
    .select()
    .from(notice)
    .where(and(isNull(notice.deletedAt), inArray(notice.targetAudience, ['TECHNICIAN', 'ALL']), inArray(notice.noticeType, ['ALL', 'SAFETY', 'BRANCH'])))
    .orderBy(desc(notice.publishFrom))
    .limit(300);
  const visible = sortNotices(rows.filter((n) => noticeVisibleTo(n, { kind: 'TECHNICIAN', branchId: tech.branchId }, now)));
  const read = visible.length
    ? await db
        .select({ noticeId: noticeRead.noticeId })
        .from(noticeRead)
        .where(and(eq(noticeRead.readerType, 'TECHNICIAN'), eq(noticeRead.readerId, tech.id), inArray(noticeRead.noticeId, visible.map((n) => n.id))))
    : [];
  const readIds = new Set(read.map((r) => r.noticeId));
  return visible.map((n) => ({
    id: n.id,
    noticeType: n.noticeType,
    title: n.title,
    content: n.content,
    isPinned: n.isPinned,
    isPopup: n.isPopup,
    publishFrom: n.publishFrom,
    /** 필독 = 안전 공지·상단 고정·팝업 */
    required: n.noticeType === 'SAFETY' || n.isPinned || n.isPopup,
    read: readIds.has(n.id),
  }));
}

/** 공지 상세를 열면 읽음 1행 (보이지 않는 공지는 null) */
export async function readTechNotice(tech: { id: number; branchId: number }, id: number, now = new Date()) {
  const db = getDb();
  const [n] = await db.select().from(notice).where(and(eq(notice.id, id), isNull(notice.deletedAt)));
  if (!n || !noticeVisibleTo(n, { kind: 'TECHNICIAN', branchId: tech.branchId }, now)) return null;
  await db.insert(noticeRead).values({ noticeId: id, readerType: 'TECHNICIAN', readerId: tech.id, readAt: now }).onConflictDoNothing();
  return n;
}

/* ---------- FAQ (A-CNT-020, C-CS-010) ---------- */

export async function listFaqs(audience: string | null) {
  return getDb()
    .select()
    .from(faq)
    .where(and(isNull(faq.deletedAt), audience ? eq(faq.audience, audience) : undefined))
    .orderBy(asc(faq.audience), asc(faq.sortOrder), asc(faq.id));
}

export async function saveFaq(input: z.output<typeof faqInput>, actor: Actor, now = new Date()) {
  const db = getDb();
  const values = {
    category: input.category,
    audience: input.audience,
    question: input.question,
    answer: input.answer,
    isPublished: input.isPublished,
    sortOrder: input.sortOrder ?? 0,
    updatedAt: now,
    updatedBy: actor.id,
  };
  if (input.id) {
    const done = await db.update(faq).set(values).where(and(eq(faq.id, input.id), isNull(faq.deletedAt))).returning({ id: faq.id });
    if (!done.length) throw new UserError('FAQ를 찾을 수 없습니다.');
    return input.id;
  }
  const [row] = await db.insert(faq).values({ ...values, createdBy: actor.id }).returning({ id: faq.id });
  return row!.id;
}

export async function deleteFaq(id: number, actor: Actor, now = new Date()) {
  await getDb().update(faq).set({ deletedAt: now, updatedAt: now, updatedBy: actor.id }).where(eq(faq.id, id));
}

/** C-CS-010 고객 FAQ (게시된 것만) */
export async function publishedFaqs(audience: 'CUSTOMER' | 'TECHNICIAN') {
  return getDb()
    .select({ id: faq.id, category: faq.category, question: faq.question, answer: faq.answer })
    .from(faq)
    .where(and(isNull(faq.deletedAt), eq(faq.isPublished, true), eq(faq.audience, audience)))
    .orderBy(asc(faq.sortOrder), asc(faq.id));
}
