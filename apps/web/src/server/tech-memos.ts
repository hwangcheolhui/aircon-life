import 'server-only';
/**
 * 메모 서버 서비스 (단계 10): 기사 메모 F-TEC-MEMO-01(T-MEMO-010) · 캘린더 메모 모드 F-TEC-CAL-02(T-CAL-010) · 오늘의 메모 F-TEC-HOM-02(T-MEMO-020)
 * · 관리자 지정 메모 발송 F-ADM-CNT-04(A-CNT-040).
 * - 기사가 보는 메모 = 본인이 쓴 메모 + 본인에게 지정된 메모(memo_recipient). 기간·반복은 domain memoOccursOn.
 * - 기사는 본인 메모만 고치고 지운다(canEditMemo). 받은 메모는 [확인](read_at)만.
 * - 관리자 지정 메모는 수신 기사마다 memo_recipient 1행 + 앱 알림(TECH_MEMO_ASSIGNED). 팝업 켠 메모는 확인 전까지 기사 홈에 팝업.
 * - 미수금 메모(단계 6, owner ADMIN·수신자 없음)는 관련 주문 담당 기사에게 보이지 않는다(기존과 같음).
 */
import type { assignedMemoInput, techMemoInput, z } from '@aircon/contracts';
import { adminUser, assignment, memo, memoRecipient, serviceOrder, technician } from '@aircon/db';
import {
  type BranchFilter,
  CONFIRMED_ASSIGN_STATUSES,
  adminMemoSource,
  canEditMemo,
  checkMemoInput,
  kstDate,
  memoOccursOn,
  sortTodayMemos,
} from '@aircon/domain';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { UserError, ValidationFailed } from './action-result';
import { getDb } from './db';
import { notifyStaffWith } from './notify';

export interface TechMemo {
  id: number;
  headerCode: string | null;
  content: string;
  startDate: string;
  endDate: string;
  repeatType: string;
  isDone: boolean;
  popupEnabled: boolean;
  prioritySource: string | null;
  mine: boolean;
  /** 받은 메모: 확인 시각 */
  readAt: Date | null;
  authorName: string;
  relatedOrderNo: string | null;
}

/** 기사가 볼 메모 중 from~to 기간과 겹치는 것 (반복은 아직 거르지 않음) */
export async function techMemosOverlapping(tech: { id: number; name: string }, from: string, to: string): Promise<TechMemo[]> {
  const db = getDb();
  const received = db.select({ memoId: memoRecipient.memoId }).from(memoRecipient).where(and(eq(memoRecipient.receiverType, 'TECHNICIAN'), eq(memoRecipient.receiverId, tech.id)));
  const rows = await db
    .select({ m: memo, orderNo: serviceOrder.orderNo, adminName: adminUser.name, readAt: memoRecipient.readAt })
    .from(memo)
    .leftJoin(serviceOrder, eq(serviceOrder.id, memo.relatedOrderId))
    .leftJoin(adminUser, and(eq(memo.ownerType, 'ADMIN'), eq(adminUser.id, memo.ownerId)))
    .leftJoin(memoRecipient, and(eq(memoRecipient.memoId, memo.id), eq(memoRecipient.receiverType, 'TECHNICIAN'), eq(memoRecipient.receiverId, tech.id)))
    .where(
      and(
        isNull(memo.deletedAt),
        lte(memo.startDate, to),
        gte(memo.endDate, from),
        or(and(eq(memo.ownerType, 'TECHNICIAN'), eq(memo.ownerId, tech.id)), inArray(memo.id, received)),
      ),
    )
    .orderBy(memo.startDate, memo.id)
    .limit(1000);
  return rows.map((r) => ({
    id: r.m.id,
    headerCode: r.m.headerCode,
    content: r.m.content,
    startDate: r.m.startDate,
    endDate: r.m.endDate,
    repeatType: r.m.repeatType,
    isDone: r.m.isDone,
    popupEnabled: r.m.popupEnabled,
    prioritySource: r.m.prioritySource ?? (r.m.ownerType === 'TECHNICIAN' ? 'SELF' : 'ADMIN'),
    mine: canEditMemo(r.m, tech.id),
    readAt: r.readAt,
    authorName: r.m.ownerType === 'TECHNICIAN' ? '본인' : (r.adminName ?? '관리자'),
    relatedOrderNo: r.orderNo,
  }));
}

/** 그날 메모 (오늘의 메모 우선순위 순) */
export async function techMemosOn(tech: { id: number; name: string }, date: string) {
  return sortTodayMemos((await techMemosOverlapping(tech, date, date)).filter((m) => memoOccursOn(m, date)));
}

/** 홈 팝업(T-MEMO-020): 오늘 보이는 받은 메모 중 팝업을 켰고 아직 확인하지 않은 것 */
export async function popupMemos(tech: { id: number; name: string }, now = new Date()) {
  return (await techMemosOn(tech, kstDate(now))).filter((m) => !m.mine && m.popupEnabled && !m.readAt);
}

export async function getTechMemo(tech: { id: number; name: string }, id: number) {
  const [row] = await getDb()
    .select({ m: memo, orderNo: serviceOrder.orderNo })
    .from(memo)
    .leftJoin(serviceOrder, eq(serviceOrder.id, memo.relatedOrderId))
    .where(and(eq(memo.id, id), isNull(memo.deletedAt)));
  if (!row || !canEditMemo(row.m, tech.id)) return null;
  return { ...row.m, relatedOrderNo: row.orderNo };
}

/** 관련 주문 연결: 내게 확정 배정된 주문만 */
async function myOrderId(techId: number, orderNo: string | null) {
  if (!orderNo) return null;
  const [row] = await getDb()
    .select({ id: serviceOrder.id })
    .from(serviceOrder)
    .innerJoin(assignment, eq(assignment.orderId, serviceOrder.id))
    .where(and(eq(serviceOrder.orderNo, orderNo), eq(assignment.technicianId, techId), inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES])));
  if (!row) throw new ValidationFailed({ relatedOrderNo: '내 작업의 접수번호만 연결할 수 있습니다.' });
  return row.id;
}

/** F-TEC-MEMO-01 메모 저장 (등록·수정) */
export async function saveTechMemo(techId: number, input: z.output<typeof techMemoInput>, now = new Date()) {
  const errors = checkMemoInput({ ...input, today: kstDate(now) });
  if (errors) throw new ValidationFailed(errors);
  const relatedOrderId = await myOrderId(techId, input.relatedOrderNo);
  const values = {
    headerCode: input.headerCode,
    content: input.content,
    startDate: input.startDate,
    endDate: input.endDate,
    isAllDay: input.startDate === input.endDate || input.repeatType !== 'NONE',
    repeatType: input.repeatType,
    relatedOrderId,
    updatedAt: now,
    updatedBy: techId,
  };
  const db = getDb();
  if (input.id) {
    const [m] = await db.select().from(memo).where(and(eq(memo.id, input.id), isNull(memo.deletedAt)));
    if (!m || !canEditMemo(m, techId)) throw new UserError('본인이 쓴 메모만 고칠 수 있습니다.');
    await db.update(memo).set(values).where(eq(memo.id, m.id));
    return m.id;
  }
  const [row] = await db
    .insert(memo)
    .values({ ...values, ownerType: 'TECHNICIAN', ownerId: techId, prioritySource: 'SELF', createdBy: techId })
    .returning({ id: memo.id });
  return row!.id;
}

export async function deleteTechMemo(techId: number, id: number, now = new Date()) {
  const db = getDb();
  const [m] = await db.select().from(memo).where(and(eq(memo.id, id), isNull(memo.deletedAt)));
  if (!m || !canEditMemo(m, techId)) throw new UserError('본인이 쓴 메모만 지울 수 있습니다.');
  await db.update(memo).set({ deletedAt: now, updatedAt: now, updatedBy: techId }).where(eq(memo.id, id));
}

/** 본인 메모 완료 체크 / 해제 */
export async function setTechMemoDone(techId: number, id: number, done: boolean, now = new Date()) {
  const db = getDb();
  const [m] = await db.select().from(memo).where(and(eq(memo.id, id), isNull(memo.deletedAt)));
  if (!m || !canEditMemo(m, techId)) throw new UserError('본인이 쓴 메모만 완료 표시할 수 있습니다.');
  await db.update(memo).set({ isDone: done, updatedAt: now, updatedBy: techId }).where(eq(memo.id, id));
}

/** 받은 메모 [확인] (T-MEMO-020) — 아직 확인하지 않은 것만 시각을 남긴다 */
export async function confirmReceivedMemos(techId: number, ids: number[], now = new Date()) {
  if (!ids.length) return;
  await getDb()
    .update(memoRecipient)
    .set({ readAt: now })
    .where(and(inArray(memoRecipient.memoId, ids), eq(memoRecipient.receiverType, 'TECHNICIAN'), eq(memoRecipient.receiverId, techId), isNull(memoRecipient.readAt)));
}

/* ---------- 관리자 지정 메모 (A-CNT-040) ---------- */

const branchCond = (filter: BranchFilter) =>
  filter.kind === 'ALL' ? undefined : filter.kind === 'NONE' ? sql`false` : eq(technician.branchId, filter.branchId);

/** 수신 기사 후보: 거점 범위 안 교육중·활동·휴직 기사 */
export async function memoTargetTechs(filter: BranchFilter) {
  return getDb()
    .select({ id: technician.id, name: technician.name, displayName: technician.displayName, branchId: technician.branchId, status: technician.status })
    .from(technician)
    .where(and(isNull(technician.deletedAt), inArray(technician.status, ['TRAINING', 'ACTIVE', 'PAUSED']), branchCond(filter)))
    .orderBy(technician.name)
    .limit(500);
}

/** F-ADM-CNT-04 지정 메모 발송: 메모 1행 + 수신자 N행, 수신 기사에게 앱 알림 */
export async function sendAssignedMemo(
  input: z.output<typeof assignedMemoInput>,
  admin: { adminId: number; roleCode: string },
  filter: BranchFilter,
  now = new Date(),
) {
  const errors = checkMemoInput({ ...input, today: kstDate(now) });
  if (errors) throw new ValidationFailed(errors);
  const ids = [...new Set(input.technicianIds)];
  const targets = await memoTargetTechs(filter);
  const allowed = targets.filter((t) => ids.includes(t.id));
  if (allowed.length !== ids.length) throw new UserError('다른 거점 기사나 메모를 받을 수 없는 기사가 포함되어 있습니다. 수신 기사를 다시 골라 주세요.');
  const db = getDb();
  const memoId = await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(memo)
      .values({
        ownerType: 'ADMIN',
        ownerId: admin.adminId,
        headerCode: input.headerCode,
        content: input.content,
        startDate: input.startDate,
        endDate: input.endDate,
        isAllDay: true,
        repeatType: input.repeatType,
        popupEnabled: input.popupEnabled,
        prioritySource: adminMemoSource(admin.roleCode),
        createdBy: admin.adminId,
        updatedBy: admin.adminId,
      })
      .returning({ id: memo.id });
    await tx.insert(memoRecipient).values(allowed.map((t) => ({ memoId: m!.id, receiverType: 'TECHNICIAN', receiverId: t.id })));
    return m!.id;
  });
  const preview = input.content.length > 60 ? `${input.content.slice(0, 60)}…` : input.content;
  for (const t of allowed) {
    await notifyStaffWith('TECH_MEMO_ASSIGNED', { type: 'TECHNICIAN', id: t.id }, { type: 'MEMO', id: memoId }, { 기사명: t.name, 메모: preview }, `/tech/calendar?mode=memo&date=${input.startDate}`);
  }
  return { memoId, count: allowed.length };
}

/** A-CNT-040 보낸 지정 메모 목록: 수신 인원·확인 인원 (거점 범위 안 수신자만 센다) */
export async function listAssignedMemos(filter: BranchFilter) {
  const db = getDb();
  const rows = await db
    .select({
      id: memo.id,
      headerCode: memo.headerCode,
      content: memo.content,
      startDate: memo.startDate,
      endDate: memo.endDate,
      repeatType: memo.repeatType,
      popupEnabled: memo.popupEnabled,
      prioritySource: memo.prioritySource,
      createdAt: memo.createdAt,
      authorName: adminUser.name,
      recipients: sql<number>`count(${memoRecipient.receiverId})::int`,
      readCount: sql<number>`count(${memoRecipient.readAt})::int`,
      names: sql<string>`string_agg(${technician.name}, ', ' order by ${technician.name})`,
    })
    .from(memo)
    .innerJoin(memoRecipient, and(eq(memoRecipient.memoId, memo.id), eq(memoRecipient.receiverType, 'TECHNICIAN')))
    .innerJoin(technician, eq(technician.id, memoRecipient.receiverId))
    .leftJoin(adminUser, eq(adminUser.id, memo.ownerId))
    .where(and(eq(memo.ownerType, 'ADMIN'), isNull(memo.deletedAt), branchCond(filter)))
    .groupBy(memo.id, adminUser.name)
    .orderBy(desc(memo.createdAt))
    .limit(300);
  return rows;
}

/** 지정 메모 취소(소프트 삭제): 보낸 사람 또는 슈퍼관리자 범위(ALL)만 */
export async function deleteAssignedMemo(id: number, admin: { adminId: number }, filter: BranchFilter, now = new Date()) {
  const db = getDb();
  const [m] = await db.select().from(memo).where(and(eq(memo.id, id), eq(memo.ownerType, 'ADMIN'), isNull(memo.deletedAt)));
  if (!m) throw new UserError('메모를 찾을 수 없습니다.');
  if (m.ownerId !== admin.adminId && filter.kind !== 'ALL') throw new UserError('본인이 보낸 메모만 취소할 수 있습니다.');
  await db.update(memo).set({ deletedAt: now, updatedAt: now, updatedBy: admin.adminId }).where(eq(memo.id, id));
}
