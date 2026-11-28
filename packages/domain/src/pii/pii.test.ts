import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptPii, encryptPii, hashPhone, isValidPiiKey, normalizePiiKey } from './crypto';
import { maskEmail, maskName, maskPhone } from './mask';

describe('BR-100 개인정보 마스킹', () => {
  it('BR-100 이름은 가운데 글자를 가린다', () => {
    expect(maskName('김수빈')).toBe('김*빈');
    expect(maskName('남궁민수')).toBe('남**수');
    expect(maskName('이은')).toBe('이*');
    expect(maskName('')).toBe('');
  });

  it('BR-100 전화번호는 가운데 자리를 가린다', () => {
    expect(maskPhone('010-1234-7789')).toBe('010-****-7789');
    expect(maskPhone('01012347789')).toBe('010-****-7789');
    expect(maskPhone('02-123-4567')).toBe('02-***-4567');
    expect(maskPhone(null)).toBe('');
  });

  it('BR-100 이메일은 앞 두 글자만 보인다', () => {
    expect(maskEmail('abcdef@example.com')).toBe('ab****@example.com');
  });
});

describe('개인정보 암호화·해시 (ERD §6)', () => {
  const key = randomBytes(32).toString('base64');

  it('암호화한 값을 같은 키로 복호화할 수 있고 매번 다른 암호문이 나온다', () => {
    const a = encryptPii('010-0000-0000', key);
    const b = encryptPii('010-0000-0000', key);
    expect(a).not.toBe(b);
    expect(decryptPii(a, key)).toBe('010-0000-0000');
  });

  it('다른 키로는 복호화되지 않는다', () => {
    const enc = encryptPii('secret', key);
    expect(() => decryptPii(enc, randomBytes(32).toString('base64'))).toThrow();
  });

  it('전화번호 해시는 형식(하이픈)에 관계없이 같다', () => {
    expect(hashPhone('010-0000-1111', 'p')).toBe(hashPhone('01000001111', 'p'));
    expect(hashPhone('010-0000-1111', 'p')).not.toBe(hashPhone('010-0000-1111', 'q'));
  });
});

describe('PII_ENCRYPTION_KEY 값 정리', () => {
  const key = randomBytes(32).toString('base64');
  it('붙여 넣을 때 생기는 공백·따옴표·"이름=" 접두어를 걷어 낸다', () => {
    expect(normalizePiiKey(` ${key}\n`)).toBe(key);
    expect(normalizePiiKey(`"${key}"`)).toBe(key);
    expect(normalizePiiKey(`'${key}'`)).toBe(key);
    expect(normalizePiiKey(`PII_ENCRYPTION_KEY=${key}`)).toBe(key);
    expect(normalizePiiKey(`PII_ENCRYPTION_KEY="${key}"`)).toBe(key);
  });
  it('정리한 키로 암호화·복호화가 된다', () => {
    expect(decryptPii(encryptPii('홍길동', key), normalizePiiKey(`"${key}"`))).toBe('홍길동');
  });
  it('32바이트 base64 가 아니면 올바른 키가 아니다', () => {
    expect(isValidPiiKey(key)).toBe(true);
    expect(isValidPiiKey('not-a-valid-key')).toBe(false);
    expect(isValidPiiKey('')).toBe(false);
    expect(isValidPiiKey(randomBytes(16).toString('base64'))).toBe(false);
  });
});
