import 'server-only';
import { decryptPii, encryptPii, hashPhone, isValidPiiKey, normalizePiiKey } from '@aircon/domain/server';
import { ConfigError } from './action-result';

function key() {
  const k = normalizePiiKey(process.env.PII_ENCRYPTION_KEY ?? '');
  if (!k) throw new ConfigError('PII_ENCRYPTION_KEY가 설정되지 않았습니다.');
  if (!isValidPiiKey(k)) throw new ConfigError('PII_ENCRYPTION_KEY는 32바이트 base64 값이어야 합니다(openssl rand -base64 32).');
  return k;
}
function pepper() {
  const p = process.env.PII_HASH_PEPPER;
  if (!p) throw new ConfigError('PII_HASH_PEPPER가 설정되지 않았습니다.');
  return p;
}
export const encrypt = (v: string | null) => (v ? encryptPii(v, key()) : null);
/**
 * 복호화(화면 표시용). 키 설정이 비었거나 형식이 틀렸거나, 데이터를 암호화한 키와 다르면
 * 화면 전체가 깨지지 않도록 null 을 돌려주고 서버 로그에 원인을 남긴다.
 * 저장(encrypt)·검색(phoneHash)은 설정 오류를 ConfigError 로 그대로 알려 화면에 메시지가 뜬다.
 */
export const decrypt = (v: string | null) => {
  if (!v) return null;
  let k: string;
  try {
    k = key();
  } catch (e) {
    warnConfig(e);
    return null;
  }
  try {
    return decryptPii(v, k);
  } catch {
    warnDecryptFailure();
    return null;
  }
};
let warned = 0;
let configWarned = 0;
function warnConfig(e: unknown) {
  if (configWarned++ % 100 === 0) {
    console.error(`[PII] 복호화 건너뜀: ${e instanceof Error ? e.message : String(e)} Vercel 환경변수 PII_ENCRYPTION_KEY 를 확인하세요. (docs/07_테스트데이터.md)`);
  }
}
function warnDecryptFailure() {
  if (warned++ % 100 === 0) {
    console.error('[PII] 복호화 실패: PII_ENCRYPTION_KEY 가 이 데이터를 암호화한 키와 다릅니다. Vercel 과 GitHub Secret(DB 준비)의 값을 같게 맞추세요. (docs/07_테스트데이터.md)');
  }
}
/** 전화번호 검색용 해시 (customer.phone1_hash, ERD §6) */
export const phoneHash = (phone: string) => hashPhone(phone, pepper());

/** 여러 행을 한 번에 보여 주는 목록용: 복호화에 실패한 행(형식 오류·파기된 값)은 null 로 보고 화면 전체가 깨지지 않게 한다 */
export const decryptOrNull = (v: string | null) => {
  try {
    return decrypt(v);
  } catch {
    return null;
  }
};

/**
 * 설정 점검용(/api/health): 키 형식과, 저장된 암호문 몇 개를 지금 키로 풀 수 있는지 건수만 알려 준다. 값은 돌려주지 않는다.
 */
export function piiKeyStatus(samples: string[]): { key: 'ok' | 'missing' | 'invalid'; decryptOk: number; decryptFail: number } {
  const k = normalizePiiKey(process.env.PII_ENCRYPTION_KEY ?? '');
  if (!k) return { key: 'missing', decryptOk: 0, decryptFail: 0 };
  if (!isValidPiiKey(k)) return { key: 'invalid', decryptOk: 0, decryptFail: 0 };
  let ok = 0;
  for (const v of samples) {
    try {
      decryptPii(v, k);
      ok++;
    } catch {
      /* 다른 키로 암호화된 값 */
    }
  }
  return { key: 'ok', decryptOk: ok, decryptFail: samples.length - ok };
}
