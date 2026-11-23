import 'server-only';
import { decryptPii, encryptPii, hashPhone } from '@aircon/domain/server';

function key() {
  const k = process.env.PII_ENCRYPTION_KEY;
  if (!k) throw new Error('PII_ENCRYPTION_KEY가 설정되지 않았습니다.');
  return k;
}
function pepper() {
  const p = process.env.PII_HASH_PEPPER;
  if (!p) throw new Error('PII_HASH_PEPPER가 설정되지 않았습니다.');
  return p;
}
export const encrypt = (v: string | null) => (v ? encryptPii(v, key()) : null);
export const decrypt = (v: string | null) => (v ? decryptPii(v, key()) : null);
/** 전화번호 검색용 해시 (customer.phone1_hash, ERD §6) */
export const phoneHash = (phone: string) => hashPhone(phone, pepper());
