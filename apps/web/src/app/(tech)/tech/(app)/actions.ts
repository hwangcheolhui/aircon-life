'use server';
// 기사 앱 서버 액션: 로그아웃 · 이관 요청(F-TEC-JOB-05) · 연락처 보기(F-TEC-JOB-02, 감사 로그) · 내 정보(F-TEC-MY-01)
import { techPasswordSetInput, techProfileInput, transferRequestInput } from '@aircon/contracts';
import { SETTING_KEYS, validatePasswordRule } from '@aircon/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { UserError, handle, parse } from '@/server/action-result';
import { requestTransfer } from '@/server/dispatch';
import { getSettingNumber } from '@/server/settings';
import { revealTechJobContact, updateTechIntro } from '@/server/tech-jobs';
import { endTechSession, requireTechAction, setTechPassword } from '@/server/tech-session';

export async function logoutTech() {
  await endTechSession();
  redirect('/tech/login');
}

/** F-TEC-JOB-05 타 기사 이관 요청 (운영자 승인 후 재배정) */
export async function requestJobTransfer(values: Record<string, string>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(transferRequestInput, values);
    await requestTransfer(me.id, v.orderNo, v.reason);
    revalidatePath(`/tech/jobs/${v.orderNo}`);
    revalidatePath('/tech/jobs');
  });
}

/** 고객 연락처·상세주소 원문 (감사 로그) */
export async function revealJobContact(orderNo: string) {
  return handle(async () => {
    const me = await requireTechAction();
    return revealTechJobContact(me.id, String(orderNo));
  });
}

export async function saveIntro(values: Record<string, string>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(techProfileInput, values);
    await updateTechIntro(me.id, v.intro);
    revalidatePath('/tech/my');
  });
}

export async function savePassword(values: Record<string, string>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(techPasswordSetInput, values);
    const err = validatePasswordRule(v.newPassword, await getSettingNumber(SETTING_KEYS.TECH_PASSWORD_MIN_LENGTH));
    if (err) throw new UserError(err);
    await setTechPassword(me.id, v.newPassword);
  });
}
