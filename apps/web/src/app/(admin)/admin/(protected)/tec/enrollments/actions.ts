'use server';
// A-TEC-041 수강·수료 관리 서버 액션 · F-ADM-TEC-06: 수강 등록, 출석률·실습 점수 저장, 수료/미수료 판정(수료증 번호), 중도 포기
import { enrollmentAddInput, enrollmentScoreInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { addEnrollment, scoreEnrollment } from '@/server/training';

export async function addEnrollmentAction(values: Record<string, string>) {
  return handle(async () => {
    const admin = await requirePermission('A-TEC-041', 'CREATE');
    await addEnrollment(parse(enrollmentAddInput, values), admin);
    revalidatePath('/admin/tec/enrollments');
    revalidatePath('/admin/tec/courses');
  });
}

export async function scoreEnrollmentAction(values: Record<string, string>) {
  return handle(async () => {
    const admin = await requirePermission('A-TEC-041', 'UPDATE');
    const r = await scoreEnrollment(parse(enrollmentScoreInput, values), admin);
    revalidatePath('/admin/tec/enrollments');
    revalidatePath('/admin/tec/courses');
    return r;
  });
}
