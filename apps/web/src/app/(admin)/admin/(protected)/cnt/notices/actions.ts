'use server';
// A-CNT-010 공지사항 서버 액션 · F-ADM-CNT-01: 등록·수정·삭제. 작성 범위는 역할 범위(BR-102, domain canWriteNotice) — 상단 거점 선택과 무관
import { noticeInput, z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { resolveBranchFilter } from '@aircon/domain';
import { deleteNotice, saveNotice } from '@/server/content';

export async function saveNoticeAction(values: Record<string, string>, id: string | null) {
  return handle(async () => {
    const admin = await requirePermission('A-CNT-010', id ? 'UPDATE' : 'CREATE');
    const v = parse(noticeInput, { ...values, id: id ?? '' });
    await saveNotice(v, resolveBranchFilter(admin, null), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/cnt/notices');
  });
}

export async function deleteNoticeAction(id: string) {
  return handle(async () => {
    const admin = await requirePermission('A-CNT-010', 'DELETE');
    await deleteNotice(parse(z.coerce.number().int().positive(), id), resolveBranchFilter(admin, null), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/cnt/notices');
  });
}
