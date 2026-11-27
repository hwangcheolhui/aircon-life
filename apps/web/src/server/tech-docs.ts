import 'server-only';
/**
 * 기술자료·SOP (단계 10): 관리자 F-ADM-CNT-03(A-CNT-030) 등록·수정·삭제·버전·필독, 기사 F-TEC-EDU-01(T-EDU-010) 유형·기기 필터 조회.
 * - 첨부는 attachment(ref_type=DOC, ref_id=자료 ID)에 두고 tech_document.file_ids 에 순서대로 적는다. 비공개 저장소라 /api/files/{id} 로만 연다
 *   (기사: 로그인한 기사 누구나, 관리자: A-CNT-030 조회 권한).
 * - 버전은 domain nextDocVersion(제목·내용·첨부가 바뀌면 +1). 삭제는 소프트 삭제.
 */
import type { techDocumentInput, z } from '@aircon/contracts';
import { attachment, techDocument } from '@aircon/db';
import { checkDocFiles, joinFileIds, nextDocVersion, parseFileIds, sortTechDocs } from '@aircon/domain';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { UserError } from './action-result';
import { saveAttachment } from './attachments';
import { getDb } from './db';

async function filesOf(ids: number[]) {
  if (!ids.length) return [];
  const rows = await getDb()
    .select({ id: attachment.id, name: attachment.originalName, mimeType: attachment.mimeType, size: attachment.sizeBytes })
    .from(attachment)
    .where(and(inArray(attachment.id, ids), eq(attachment.refType, 'DOC'), isNull(attachment.deletedAt)));
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
}

export async function listTechDocs(filter: { docType?: string | null; deviceType?: string | null } = {}) {
  const rows = await getDb()
    .select()
    .from(techDocument)
    .where(
      and(
        isNull(techDocument.deletedAt),
        filter.docType ? eq(techDocument.docType, filter.docType) : undefined,
        filter.deviceType ? eq(techDocument.deviceType, filter.deviceType) : undefined,
      ),
    )
    .orderBy(desc(techDocument.updatedAt))
    .limit(500);
  return sortTechDocs(rows).map((d) => ({ ...d, fileCount: parseFileIds(d.fileIds).length }));
}

export async function getTechDoc(id: number) {
  const [d] = await getDb().select().from(techDocument).where(and(eq(techDocument.id, id), isNull(techDocument.deletedAt)));
  if (!d) return null;
  return { ...d, files: await filesOf(parseFileIds(d.fileIds)) };
}

/** 저장(등록·수정) + 새 첨부 업로드. keepFileIds = 남길 기존 첨부 */
export async function saveTechDoc(input: z.output<typeof techDocumentInput>, files: File[], adminId: number, now = new Date()) {
  const db = getDb();
  const prev = input.id ? (await db.select().from(techDocument).where(and(eq(techDocument.id, input.id), isNull(techDocument.deletedAt))))[0] : null;
  if (input.id && !prev) throw new UserError('기술자료를 찾을 수 없습니다.');
  const prevIds = parseFileIds(prev?.fileIds);
  const kept = input.keepFileIds.filter((id) => prevIds.includes(id));
  const err = checkDocFiles(files.map((f) => ({ size: f.size, type: f.type })), kept.length);
  if (err) throw new UserError(err);
  return db.transaction(async (tx) => {
    let id = prev?.id ?? null;
    if (!id) {
      const [row] = await tx
        .insert(techDocument)
        .values({ docType: input.docType, deviceType: input.deviceType, title: input.title, content: input.content, isRequiredRead: input.isRequiredRead, version: 1, createdBy: adminId, updatedBy: adminId })
        .returning({ id: techDocument.id });
      id = row!.id;
    }
    const added: number[] = [];
    for (const f of files) added.push((await saveAttachment(f, 'DOC', id, adminId, tx)).id);
    const fileIds = [...kept, ...added];
    const removed = prevIds.filter((x) => !kept.includes(x));
    if (removed.length) await tx.update(attachment).set({ deletedAt: now }).where(inArray(attachment.id, removed));
    const version = nextDocVersion(prev ? { version: prev.version, title: prev.title, content: prev.content, fileIds: prevIds } : null, { title: input.title, content: input.content, fileIds });
    await tx
      .update(techDocument)
      .set({ docType: input.docType, deviceType: input.deviceType, title: input.title, content: input.content, isRequiredRead: input.isRequiredRead, fileIds: joinFileIds(fileIds), version, updatedAt: now, updatedBy: adminId })
      .where(eq(techDocument.id, id));
    return { id, version };
  });
}

export async function deleteTechDoc(id: number, adminId: number, now = new Date()) {
  const db = getDb();
  const [d] = await db.select().from(techDocument).where(and(eq(techDocument.id, id), isNull(techDocument.deletedAt)));
  if (!d) throw new UserError('기술자료를 찾을 수 없습니다.');
  await db.update(techDocument).set({ deletedAt: now, updatedAt: now, updatedBy: adminId }).where(eq(techDocument.id, id));
}

/** /api/files: 지워지지 않은 자료의 첨부인지 */
export async function isLiveDocFile(fileId: number, refId: number | null) {
  if (!refId) return false;
  const [d] = await getDb().select({ fileIds: techDocument.fileIds }).from(techDocument).where(and(eq(techDocument.id, refId), isNull(techDocument.deletedAt)));
  return Boolean(d && parseFileIds(d.fileIds).includes(fileId));
}
