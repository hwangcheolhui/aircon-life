import 'server-only';
import { decryptPii, encryptPii } from '@aircon/domain/server';

function key() {
  const k = process.env.PII_ENCRYPTION_KEY;
  if (!k) throw new Error('PII_ENCRYPTION_KEY가 설정되지 않았습니다.');
  return k;
}
export const encrypt = (v: string | null) => (v ? encryptPii(v, key()) : null);
export const decrypt = (v: string | null) => (v ? decryptPii(v, key()) : null);
