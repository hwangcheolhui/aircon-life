'use server';
// A-CNT-020 FAQ 서버 액션 · F-ADM-CNT-02: 고객/기사 FAQ 등록·수정·삭제·게시. 상담 → FAQ 전환은 A-CSL-080
import { faqInput, z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { deleteFaq, saveFaq } from '@/server/content';

export async function saveFaqAction(values: Record<string, string>, id: string | null) {
  return handle(async () => {
    const admin = await requirePermission('A-CNT-020', id ? 'UPDATE' : 'CREATE');
    const v = parse(faqInput, { ...values, id: id ?? '' });
    await saveFaq(v, { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/cnt/faqs');
    revalidatePath('/cs');
  });
}

export async function deleteFaqAction(id: string) {
  return handle(async () => {
    const admin = await requirePermission('A-CNT-020', 'DELETE');
    await deleteFaq(parse(z.coerce.number().int().positive(), id), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/cnt/faqs');
    revalidatePath('/cs');
  });
}
