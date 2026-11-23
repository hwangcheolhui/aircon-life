'use server';
// T-AUTH-010 기사 로그인 서버 액션 (F-TEC-AUTH-01)
import { techOtpConfirmInput, techOtpStartInput, techPasswordLoginInput, z } from '@aircon/contracts';
import { handle, parse } from '@/server/action-result';
import { beginTechOtp, confirmTechIdentity, confirmTechOtp, techPasswordLogin } from '@/server/tech-session';

export async function loginWithPassword(values: Record<string, string>) {
  return handle(async () => {
    const v = parse(techPasswordLoginInput, values);
    await techPasswordLogin(v.phone, v.password);
  });
}

/** 인증번호 받기 (모의). 임시 테스트 모드면 바로 로그인 */
export async function requestTechCode(values: Record<string, string>) {
  return handle(async () => beginTechOtp(parse(techOtpStartInput, values).phone));
}

export async function confirmTechCode(values: Record<string, string>) {
  return handle(async () => {
    const v = parse(techOtpConfirmInput, values);
    await confirmTechOtp(v.phone, v.code);
  });
}

/** 포트원 본인인증 결과로 로그인 */
export async function confirmTechPortOne(identityVerificationId: string) {
  return handle(async () => confirmTechIdentity(parse(z.string().min(1).max(100), identityVerificationId)));
}
