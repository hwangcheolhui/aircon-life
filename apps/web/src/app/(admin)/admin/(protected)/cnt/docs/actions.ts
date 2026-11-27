'use server';
// A-CNT-030 기술자료·SOP 서버 액션 · F-ADM-CNT-03: 등록·수정(첨부 업로드, 버전 자동 증가)·삭제(소프트)
import { techDocumentInput, z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { deleteTechDoc, getTechDoc, saveTechDoc } from '@/server/tech-docs';

const PATH = '/admin/cnt/docs';

export async function saveTechDocAction(fd: FormData) {
  return handle(async () => {
    const id = String(fd.get('id') ?? '');
    const admin = await requirePermission('A-CNT-030', id ? 'UPDATE' : 'CREATE');
    const v = parse(techDocumentInput, {
      id,
      docType: fd.get('docType'),
      deviceType: fd.get('deviceType'),
      title: fd.get('title'),
      content: fd.get('content'),
      isRequiredRead: fd.get('isRequiredRead') === 'true',
      keepFileIds: fd.getAll('keepFileIds').map(String),
    });
    const files = fd.getAll('files').filter((f): f is File => typeof f === 'object' && f !== null && 'size' in f && (f as File).size > 0);
    const r = await saveTechDoc(v, files, admin.adminId);
    revalidatePath(PATH);
    revalidatePath('/tech/docs');
    return r;
  });
}

/** 수정 창: 첨부 목록 */
export async function techDocDetailAction(id: number) {
  return handle(async () => {
    await requirePermission('A-CNT-030', 'READ');
    const d = await getTechDoc(parse(z.coerce.number().int().positive(), id));
    if (!d) return null;
    return { files: d.files };
  });
}

export async function deleteTechDocAction(id: number) {
  return handle(async () => {
    const admin = await requirePermission('A-CNT-030', 'DELETE');
    await deleteTechDoc(parse(z.coerce.number().int().positive(), id), admin.adminId);
    revalidatePath(PATH);
    revalidatePath('/tech/docs');
  });
}
