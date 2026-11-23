'use server';
// A-TEC-020 기사 상세 서버 액션 (F-ADM-TEC-02·03). 모든 액션 첫 줄에서 권한 확인, 기사 소속 거점 범위(BR-102)
import { gradeChangeInput, technicianAreasInput, technicianProfileInput, technicianSkillsInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import {
  changeTechnicianGrade,
  revealTechnicianPii,
  saveTechnicianAreas,
  saveTechnicianProfile,
  saveTechnicianSkills,
  unlockTechnicianLogin,
} from '@/server/admin-technicians';
import { requirePermission } from '@/server/auth';

const MENU = 'A-TEC-020';
const done = (id: number) => {
  revalidatePath(`/admin/tec/technicians/${id}`);
  revalidatePath('/admin/tec/technicians');
};

export async function saveProfile(id: number, values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    await saveTechnicianProfile(Number(id), parse(technicianProfileInput, values), admin);
    done(id);
  });
}

export async function saveSkills(values: unknown) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const v = parse(technicianSkillsInput, values);
    await saveTechnicianSkills(v.technicianId, v.skills, admin);
    done(v.technicianId);
  });
}

export async function saveAreas(values: unknown) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const v = parse(technicianAreasInput, values);
    await saveTechnicianAreas(v.technicianId, v.areas, admin);
    done(v.technicianId);
  });
}

export async function changeGrade(values: Record<string, string>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const v = parse(gradeChangeInput, values);
    await changeTechnicianGrade(v, admin);
    done(v.technicianId);
  });
}

export async function viewPii(id: number) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    return revealTechnicianPii(Number(id), admin);
  });
}

export async function unlockLogin(id: number) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    await unlockTechnicianLogin(Number(id), admin);
    done(id);
  });
}
