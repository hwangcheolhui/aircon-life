import { describe, expect, it } from 'vitest';
import { CONSENT_ITEMS, consentChanges, validateSignupConsents } from './consent';
import { renderTemplate } from './notify-template';

describe('F-CUS-AUTH-01·03 가입 약관 동의', () => {
  it('필수(이용약관·개인정보) 동의가 모두 있어야 가입할 수 있다', () => {
    expect(validateSignupConsents({ TERMS: true, PRIVACY_REQUIRED: true })).toBeNull();
  });
  it('예외: 필수 동의가 빠지면 가입할 수 없다', () => {
    expect(validateSignupConsents({ TERMS: true, PRIVACY_REQUIRED: false })).toMatch(/필수/);
    expect(validateSignupConsents({ MARKETING_SMS: true })).toMatch(/필수/);
  });
  it('필수 항목은 이용약관·개인정보 2개, 나머지는 선택', () => {
    expect(CONSENT_ITEMS.filter((c) => c.required).map((c) => c.type)).toEqual(['TERMS', 'PRIVACY_REQUIRED']);
  });
});

describe('F-CUS-AUTH-03 동의 변경 이력 (consent_history INSERT ONLY)', () => {
  it('바뀐 항목만 동의(AGREE)/철회(WITHDRAW) 이력으로 남긴다', () => {
    expect(consentChanges({ MARKETING_SMS: false, LOCATION: true }, { MARKETING_SMS: true, LOCATION: true })).toEqual([
      { consentType: 'MARKETING_SMS', action: 'AGREE' },
    ]);
    expect(consentChanges({ MARKETING_SMS: true }, { MARKETING_SMS: false })).toEqual([
      { consentType: 'MARKETING_SMS', action: 'WITHDRAW' },
    ]);
  });
  it('예외: 필수 동의는 설정 화면에서 철회할 수 없다(철회 = 탈퇴, ERD §6)', () => {
    expect(() => consentChanges({ TERMS: true }, { TERMS: false })).toThrow(/탈퇴/);
  });
});

describe('알림 템플릿 치환 (notification_template.body)', () => {
  it('#{변수}를 값으로 바꾸고 없는 변수는 빈칸', () => {
    expect(renderTemplate('#{고객명}님 #{접수번호} 접수 #{없음}.', { 고객명: '김*빈', 접수번호: '2611221530A1' })).toBe(
      '김*빈님 2611221530A1 접수 .',
    );
  });
});
