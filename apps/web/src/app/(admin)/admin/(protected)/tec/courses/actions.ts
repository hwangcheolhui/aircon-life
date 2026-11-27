'use server';
// A-TEC-040 교육 과정 서버 액션 · F-ADM-TEC-05: 과정·기수 등록·수정·삭제, 상태 모집중 → 진행중 → 종료(01_ERD §3.21)
import { trainingCourseInput, z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { deleteCourse, saveCourse } from '@/server/training';

export async function saveCourseAction(values: Record<string, string>, id: string | null) {
  return handle(async () => {
    const admin = await requirePermission('A-TEC-040', id ? 'UPDATE' : 'CREATE');
    await saveCourse(parse(trainingCourseInput, { ...values, id: id ?? '' }), admin);
    revalidatePath('/admin/tec/courses');
  });
}

export async function deleteCourseAction(id: string) {
  return handle(async () => {
    const admin = await requirePermission('A-TEC-040', 'DELETE');
    await deleteCourse(parse(z.coerce.number().int().positive(), id), admin);
    revalidatePath('/admin/tec/courses');
  });
}
