import 'server-only';
import { decryptPii, encryptPii, hashPhone } from '@aircon/domain/server';

function key() {
  const k = process.env.PII_ENCRYPTION_KEY;
  if (!k) throw new Error('PII_ENCRYPTION_KEY가 설정되지 않았습니다.');
  return k;
}
export const encrypt = (v: string | null) => (v ? encryptPii(v, key()) : null);
export const decrypt = (v: string | null) => (v ? decryptPii(v, key()) : null);

/** 전화번호 검색·중복 확인용 해시(`*_hash`, ERD §6) */
export function phoneHash(phone: string) {
  const pepper = process.env.PII_HASH_PEPPER;
  if (!pepper) throw new Error('PII_HASH_PEPPER가 설정되지 않았습니다.');
  return hashPhone(phone, pepper);
}
