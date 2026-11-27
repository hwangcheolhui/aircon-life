'use server';
// A-TEC-030 지원자 관리 서버 액션 · F-ADM-TEC-04: 지원서 등록·수정·삭제, 면접·불합격, 합격(기사 계정 생성 + 합격 안내)
// BR-102 거점 범위, BR-100 연락처 원문 열람 감사 로그
import { applicationAcceptInput, applicationInput, applicationStatusInput, z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { acceptApplication, applicationDetail, changeApplicationStatus, deleteApplication, saveApplication } from '@/server/training';

const MENU = 'A-TEC-030';
const PATH = '/admin/tec/applicants';

export async function saveApplicationAction(values: Record<string, string>, id: string | null) {
  return handle(async () => {
    const admin = await requirePermission(MENU, id ? 'UPDATE' : 'CREATE');
    await saveApplication(parse(applicationInput, { ...values, id: id ?? '' }), admin);
    revalidatePath(PATH);
  });
}

/** 수정 창: 이름·연락처 원문 (감사 로그 VIEW_PII) */
export async function applicationDetailAction(id: number) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const a = await applicationDetail(parse(z.coerce.number().int().positive(), id), admin);
    return {
      branchId: String(a.branchId),
      name: a.name,
      phone: a.phone,
      ageGroup: a.ageGroup ?? '',
      region: a.region ?? '',
      experienceYears: a.experienceYears ?? '',
      licenses: a.licenses ?? '',
      source: a.source,
      supportTargetFlag: a.supportTargetFlag,
      note: a.note ?? '',
    };
  });
}

export async function deleteApplicationAction(id: string) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'DELETE');
    await deleteApplication(parse(z.coerce.number().int().positive(), id), admin);
    revalidatePath(PATH);
  });
}

/** 면접·불합격 */
export async function changeApplicationStatusAction(values: Record<string, string>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    await changeApplicationStatus(parse(applicationStatusInput, values), admin);
    revalidatePath(PATH);
  });
}

/** 합격 = 기사 계정 생성(교육중·견습) */
export async function acceptApplicationAction(values: Record<string, string>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'CREATE');
    const id = await acceptApplication(parse(applicationAcceptInput, values), admin);
    revalidatePath(PATH);
    revalidatePath('/admin/tec/technicians');
    return { technicianId: id };
  });
}
