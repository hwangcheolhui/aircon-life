/**
 * 고객 약관·동의 (F-CUS-AUTH-01·03, 01 §2.2.4 consent_history INSERT ONLY, ERD §6 동의·철회).
 * 앱 동의 항목: 필수(이용약관·개인정보) · 선택(위치·마케팅 문자·마케팅 푸시).
 */

export type ConsentType = 'TERMS' | 'PRIVACY_REQUIRED' | 'PRIVACY_OPTIONAL' | 'LOCATION' | 'MARKETING_SMS' | 'MARKETING_PUSH' | 'THIRD_PARTY';

/** C-AUTH-020·C-MY-030 에 보여 주는 항목 (표시명은 common_code CONSENT_TYPE) */
export const CONSENT_ITEMS: readonly { type: ConsentType; required: boolean }[] = [
  { type: 'TERMS', required: true },
  { type: 'PRIVACY_REQUIRED', required: true },
  { type: 'LOCATION', required: false },
  { type: 'MARKETING_SMS', required: false },
  { type: 'MARKETING_PUSH', required: false },
];

export const REQUIRED_CONSENTS: readonly ConsentType[] = CONSENT_ITEMS.filter((c) => c.required).map((c) => c.type);
export const OPTIONAL_CONSENTS: readonly ConsentType[] = CONSENT_ITEMS.filter((c) => !c.required).map((c) => c.type);

export type ConsentState = Partial<Record<ConsentType, boolean>>;

/** 가입 시 필수 동의 확인. 문제 없으면 null */
export function validateSignupConsents(state: ConsentState): string | null {
  return REQUIRED_CONSENTS.every((t) => state[t] === true) ? null : '필수 약관에 모두 동의해 주세요.';
}

/** 설정 변경 → 바뀐 항목만 AGREE/WITHDRAW. 필수 동의 철회는 탈퇴로만(ERD §6) */
export function consentChanges(before: ConsentState, after: ConsentState): { consentType: ConsentType; action: 'AGREE' | 'WITHDRAW' }[] {
  const out: { consentType: ConsentType; action: 'AGREE' | 'WITHDRAW' }[] = [];
  for (const { type, required } of CONSENT_ITEMS) {
    if (after[type] === undefined || Boolean(before[type]) === Boolean(after[type])) continue;
    if (required && !after[type]) throw new Error('필수 동의를 철회하려면 회원 탈퇴를 해 주세요.');
    out.push({ consentType: type, action: after[type] ? 'AGREE' : 'WITHDRAW' });
  }
  return out;
}

/** consent_history 최신 행들 → 현재 동의 상태 (최신값만 반영) */
export function currentConsents(rows: readonly { consentType: string; action: string; createdAt: Date }[]): ConsentState {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const state: ConsentState = {};
  for (const r of sorted) state[r.consentType as ConsentType] = r.action === 'AGREE';
  return state;
}
