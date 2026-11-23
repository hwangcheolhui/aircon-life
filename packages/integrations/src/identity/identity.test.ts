import { describe, expect, it } from 'vitest';
import { isIdentityAutoVerify } from './index';

describe('휴대폰 본인인증 임시 테스트 모드 (F-CUS-AUTH-01)', () => {
  it('mock 드라이버 + IDENTITY_MOCK_AUTO_VERIFY=true 일 때만 인증번호 입력을 생략한다', () => {
    expect(isIdentityAutoVerify({ IDENTITY_DRIVER: 'mock', IDENTITY_MOCK_AUTO_VERIFY: 'true' })).toBe(true);
    expect(isIdentityAutoVerify({ IDENTITY_MOCK_AUTO_VERIFY: 'true' })).toBe(true);
  });
  it('플래그가 없거나 실연동(portone)이면 생략하지 않는다', () => {
    expect(isIdentityAutoVerify({ IDENTITY_DRIVER: 'mock' })).toBe(false);
    expect(isIdentityAutoVerify({ IDENTITY_DRIVER: 'mock', IDENTITY_MOCK_AUTO_VERIFY: 'false' })).toBe(false);
    expect(isIdentityAutoVerify({ IDENTITY_DRIVER: 'portone', IDENTITY_MOCK_AUTO_VERIFY: 'true' })).toBe(false);
  });
});
