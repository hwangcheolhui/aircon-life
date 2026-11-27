'use server';
// 기사 앱 서버 액션: 로그아웃 · 이관 요청(F-TEC-JOB-05) · 연락처 보기(F-TEC-JOB-02, 감사 로그) · 내 정보(F-TEC-MY-01)
// 단계 4-2: 위치정보 수집 동의·근무 시작/종료(F-TEC-AUTH-02) · 근무 중 위치 전송(F-TEC-MAP-05, BR-115)
import {
  locationInput,
  techPasswordSetInput,
  techProfileInput,
  techSettlementResponseInput,
  transferRequestInput,
  z,
} from '@aircon/contracts';
import { SETTING_KEYS, validatePasswordRule } from '@aircon/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { UserError, handle, parse } from '@/server/action-result';
import { requestTransfer } from '@/server/dispatch';
import { getSettingNumber } from '@/server/settings';
import { techRespond } from '@/server/settlements';
import { createSafeNumberProvider } from '@aircon/integrations';
import { refreshEtas } from '@/server/route-monitor';

import { agreeLocation, endDuty, recordLocation, startDuty } from '@/server/tech-duty';
import { myAssignment, revealTechJobContact, updateTechIntro } from '@/server/tech-jobs';
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
    const r = await recordLocation(me.id, v);
    if (r.saved) await refreshEtas(me.id); // 단계 9 F-SYS-17 위치 이벤트로 남은 정류장 ETA 갱신
    return r;
  });
}

/** F-TEC-STL-02 정산 [확인] / [이의 제기(사유)] (T-STL-020) */
export async function respondSettlement(values: Record<string, unknown>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(techSettlementResponseInput, values);
    await techRespond(me.id, v.settlementId, v.action, v.note ?? '');
    revalidatePath('/tech/settlements', 'layout');
  });
}

/** 단계 9 안심번호로 고객에게 전화 (실제 번호 비공개, 02 §6). 내 진행 중 작업만 */
export async function safeCallCustomer(orderNo: string) {
  return handle(async () => {
    const me = await requireTechAction();
    const m = await myAssignment(me.id, parse(z.string().min(1).max(20), orderNo));
    if (!m || !['ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS'].includes(m.o.status)) throw new UserError('진행 중인 내 작업에서만 연결할 수 있습니다.');
    const r = await createSafeNumberProvider().issue({ orderNo: m.o.orderNo, caller: 'TECHNICIAN' });
    if (!r.ok) throw new UserError(r.failReason ?? '안심번호를 받지 못했습니다.');
    return { number: r.number! };
  });
}
