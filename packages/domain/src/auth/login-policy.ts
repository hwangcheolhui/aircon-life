/**
 * 관리자 로그인 잠금 정책 (F-ADM-SYS-01, 02 §7 "관리자 5회 로그인 실패 잠금").
 * 잠금 기준 횟수는 system_setting `ADMIN_LOGIN_MAX_FAIL`에서 읽어 넘긴다.
 */

export type AdminAccountStatus = 'ACTIVE' | 'LOCKED' | 'RETIRED';

export interface LoginAccountState {
  status: AdminAccountStatus;
  loginFailCount: number;
  deleted: boolean;
}

export type LoginOutcome =
  | { result: 'SUCCESS'; next: { status: 'ACTIVE'; loginFailCount: 0 } }
  | { result: 'INVALID_CREDENTIALS'; next: { status: AdminAccountStatus; loginFailCount: number }; remaining: number }
  | { result: 'LOCKED'; next: { status: 'LOCKED'; loginFailCount: number } }
  | { result: 'UNAVAILABLE' };

/**
 * 비밀번호 검증 결과와 현재 계정 상태로 다음 상태를 계산한다.
 * - 퇴사·삭제 계정은 로그인 불가
 * - 잠긴 계정은 비밀번호가 맞아도 로그인 불가(슈퍼관리자가 A-SYS-010에서 잠금 해제)
 * - 실패 횟수가 maxFail에 도달하면 LOCKED
 */
export function evaluateLogin(account: LoginAccountState, passwordOk: boolean, maxFail: number): LoginOutcome {
  if (account.deleted || account.status === 'RETIRED') return { result: 'UNAVAILABLE' };
  if (account.status === 'LOCKED') {
    return { result: 'LOCKED', next: { status: 'LOCKED', loginFailCount: account.loginFailCount } };
  }
  if (passwordOk) return { result: 'SUCCESS', next: { status: 'ACTIVE', loginFailCount: 0 } };
  const count = account.loginFailCount + 1;
  if (count >= maxFail) return { result: 'LOCKED', next: { status: 'LOCKED', loginFailCount: count } };
  return {
    result: 'INVALID_CREDENTIALS',
    next: { status: account.status, loginFailCount: count },
    remaining: maxFail - count,
  };
}

/** 잠금 해제 시 상태 (A-SYS-010) */
export function unlockAccount(): { status: 'ACTIVE'; loginFailCount: 0 } {
  return { status: 'ACTIVE', loginFailCount: 0 };
}

/** 비밀번호 규칙 (A-AUTH-020): 최소 길이(system_setting `ADMIN_PASSWORD_MIN_LENGTH`) 이상, 영문·숫자 포함 */
export function validatePasswordRule(pw: string, minLength: number): string | null {
  if (pw.length < minLength) return `비밀번호는 ${minLength}자 이상이어야 합니다.`;
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return '비밀번호는 영문과 숫자를 함께 포함해야 합니다.';
  return null;
}
