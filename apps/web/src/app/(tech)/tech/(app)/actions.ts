'use server';
// 기사 앱 서버 액션: 로그아웃 · 이관 요청(F-TEC-JOB-05) · 연락처 보기(F-TEC-JOB-02, 감사 로그) · 내 정보(F-TEC-MY-01)
// 단계 4-2: 위치정보 수집 동의·근무 시작/종료(F-TEC-AUTH-02) · 근무 중 위치 전송(F-TEC-MAP-05, BR-115)
import {
  locationInput,
  techPasswordSetInput,
  techProfileInput,
  transferRequestInput,
} from '@aircon/contracts';
import { SETTING_KEYS, validatePasswordRule } from '@aircon/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { UserError, handle, parse } from '@/server/action-result';
import { requestTransfer } from '@/server/dispatch';
import { getSettingNumber } from '@/server/settings';
import { agreeLocation, endDuty, recordLocation, startDuty } from '@/server/tech-duty';
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
    const err = validatePasswordRule(
      v.newPassword,
      await getSettingNumber(SETTING_KEYS.TECH_PASSWORD_MIN_LENGTH),
    );
    if (err) throw new UserError(err);
    await setTechPassword(me.id, v.newPassword);
  });
}

/** 위치정보 수집 동의 (최초 1회, 감사 로그) 후 바로 근무 시작 */
export async function agreeAndStartDuty() {
  return handle(async () => {
    const me = await requireTechAction();
    await agreeLocation(me.id);
    await startDuty(me.id);
    revalidatePath('/tech', 'layout');
  });
}

export async function setDuty(on: boolean) {
  return handle(async () => {
    const me = await requireTechAction();
    if (on) await startDuty(me.id);
    else await endDuty(me.id);
    revalidatePath('/tech', 'layout');
  });
}

/** 근무 중 위치 1건 (근무 중이 아니면 저장하지 않음, BR-115) */
export async function sendLocation(values: unknown) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(locationInput, values);
    return recordLocation(me.id, v);
  });
}
