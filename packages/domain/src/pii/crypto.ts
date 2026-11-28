/**
 * 개인정보 앱 레벨 암호화 (ERD §6, 06 §2.3): AES-256-GCM + 검색용 SHA-256 해시.
 * 키는 환경변수(PII_ENCRYPTION_KEY, PII_HASH_PEPPER)에서 읽어 주입한다. 서버 전용.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { normalizePhone } from './mask';

const VERSION = 'v1';

/**
 * 환경변수에 붙여 넣은 키 값을 정리한다: 앞뒤 공백·줄바꿈, 감싼 따옴표, `PII_ENCRYPTION_KEY=` 접두어.
 * (Vercel·GitHub 에 값을 옮겨 적을 때 흔히 섞여 들어가는 것들. 앱과 시드가 같은 규칙을 쓴다)
 */
export function normalizePiiKey(raw: string): string {
  let k = raw.trim().replace(/^PII_ENCRYPTION_KEY\s*=\s*/, '').trim();
  if (k.length >= 2 && (k[0] === '"' || k[0] === "'") && k[k.length - 1] === k[0]) k = k.slice(1, -1).trim();
  return k;
}

/** 32바이트 base64 키인지 */
export function isValidPiiKey(keyB64: string): boolean {
  return keyB64.length > 0 && Buffer.from(keyB64, 'base64').length === 32;
}

function keyFromBase64(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('PII_ENCRYPTION_KEY는 32바이트(base64)여야 합니다.');
  return key;
}

/** 형식: v1:<iv b64>:<tag b64>:<cipher b64> */
export function encryptPii(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromBase64(keyB64), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decryptPii(payload: string, keyB64: string): string {
  const [ver, ivB64, tagB64, encB64] = payload.split(':');
  if (ver !== VERSION || !ivB64 || !tagB64 || encB64 === undefined) throw new Error('암호문 형식이 올바르지 않습니다.');
  const decipher = createDecipheriv('aes-256-gcm', keyFromBase64(keyB64), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
}

/** 검색용 해시(`*_hash`). 전화번호는 숫자만 남겨 정규화한 뒤 해시한다. */
export function hashPii(value: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${value}`).digest('hex');
}

export function hashPhone(phone: string, pepper: string): string {
  return hashPii(normalizePhone(phone), pepper);
}
