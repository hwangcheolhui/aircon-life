'use server';
// C-AUTH-020·030 고객 가입·로그인 서버 액션 (F-CUS-AUTH-01·02·03·04)
import { phoneConfirmInput, phoneStartInput, signupConsentInput, z } from '@aircon/contracts';
import { handle, parse } from '@/server/action-result';
import { beginMockPhone, completeSignup, confirmMockPhone, confirmPortOneIdentity } from '@/server/customer-auth';

/** 모의 본인인증: 인증번호 받기 */
export async function requestPhoneCode(values: Record<string, string>) {
  return handle(async () => {
    const v = parse(phoneStartInput, values);
    return beginMockPhone(v.name, v.phone);
  });
}

/** 모의 본인인증: 인증번호 확인 → 기존 고객 로그인 또는 약관 동의로 */
export async function confirmPhoneCode(values: Record<string, string>) {
  return handle(async () => {
    const v = parse(phoneConfirmInput, values);
    return confirmMockPhone(v.phone, v.code);
  });
}

/** 포트원 본인인증 결과 확인 */
export async function confirmIdentity(identityVerificationId: string) {
  return handle(async () => confirmPortOneIdentity(parse(z.string().min(1).max(100), identityVerificationId)));
}

/** C-AUTH-020 약관 동의 → 가입 완료 */
export async function submitSignup(values: Record<string, boolean>, name: string | null) {
  return handle(async () => {
    const c = parse(signupConsentInput, values);
    await completeSignup(c, name);
  });
}
