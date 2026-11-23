import 'server-only';
import { decryptPii, encryptPii, hashPhone } from '@aircon/domain/server';
import { ConfigError } from './action-result';

function key() {
  const k = process.env.PII_ENCRYPTION_KEY?.trim();
  if (!k) throw new ConfigError('PII_ENCRYPTION_KEY가 설정되지 않았습니다.');
  if (Buffer.from(k, 'base64').length !== 32) throw new ConfigError('PII_ENCRYPTION_KEY는 32바이트 base64 값이어야 합니다(openssl rand -base64 32).');
  return k;
}
function pepper() {
  const p = process.env.PII_HASH_PEPPER;
  if (!p) throw new ConfigError('PII_HASH_PEPPER가 설정되지 않았습니다.');
  return p;
}
export const encrypt = (v: string | null) => (v ? encryptPii(v, key()) : null);
export const decrypt = (v: string | null) => (v ? decryptPii(v, key()) : null);
/** 전화번호 검색용 해시 (customer.phone1_hash, ERD §6) */
export const phoneHash = (phone: string) => hashPhone(phone, pepper());
