import 'server-only';
/**
 * 고객 가입·로그인 흐름 (F-CUS-AUTH-01·02·04). 화면: C-AUTH-010 로그인 → C-AUTH-030 휴대폰 인증 → (신규) C-AUTH-020 약관 동의.
 * - 휴대폰 인증이 끝난 번호로 기존 고객(전화 접수 포함)을 찾으면 그 고객 레코드에 앱 로그인을 연결한다(이력 승계, F-CUS-AUTH-04).
 * - 신규면 인증 결과를 서명 쿠키(ac_signup, 10분)에 담고 약관 동의 뒤 고객을 만든다. 쿠키 안 이름·번호는 암호화한다.
 * - 소셜 로그인으로 처음 들어온 고객도 휴대폰 인증을 거쳐 같은 고객으로 묶는다(중복 계정 방지).
 * DB 미연결 체험 모드: 인증만 흉내 내고 저장 없이 체험 고객(ID 0)으로 로그인한다.
 */
import { type ConsentState, validateSignupConsents } from '@aircon/domain';
import { createIdentityVerifier, generateMockCode, isIdentityAutoVerify, resolveIdentityDriver } from '@aircon/integrations';
import { UserError } from './action-result';
import {
  DEMO_CUSTOMER_ID,
  PHONE_CHALLENGE_COOKIE,
  SIGNUP_COOKIE,
  clearCookie,
  readSealedCookie,
  setSealedCookie,
  startCustomerSession,
} from './customer-session';
import { createCustomer, findCustomerByPhone, findCustomerBySocial, linkAppLogin } from './customers';
import { isDbConfigured } from './db';
import { decrypt, encrypt } from './pii';

const CHALLENGE_TTL = 3 * 60;
const SIGNUP_TTL = 10 * 60;
const MAX_TRIES = 5;

/** 쿠키에 넣는 개인정보: DB가 있으면 암호화, 체험 모드는 저장하지 않으므로 그대로 */
const seal = (v: string | null) => (v == null ? null : isDbConfigured() ? encrypt(v) : v);
const open = (v: string | null | undefined) => (v == null ? null : isDbConfigured() ? decrypt(v) : v);

interface Challenge {
  p: string;
  n: string | null;
  c: string;
  t: number;
}
interface Signup {
  /** 인증된 휴대폰 (없으면 소셜 로그인만 끝난 상태) */
  p: string | null;
  n: string | null;
  /** AUTH_PROVIDER */
  ap: string;
  ak: string | null;
}

export const identityDriver = () => resolveIdentityDriver(process.env.IDENTITY_DRIVER);
/** 임시 테스트 모드: [인증번호 받기]만으로 인증 완료 (IDENTITY_MOCK_AUTO_VERIFY=true, mock 한정) */
export const identityAutoVerify = () => isIdentityAutoVerify({ IDENTITY_DRIVER: process.env.IDENTITY_DRIVER, IDENTITY_MOCK_AUTO_VERIFY: process.env.IDENTITY_MOCK_AUTO_VERIFY });

/** 진행 중인 소셜 가입 (C-AUTH-030 안내 문구용) */
export async function pendingSocial(): Promise<string | null> {
  const s = await readSealedCookie<Signup>(SIGNUP_COOKIE);
  return s && !s.p && s.ap !== 'PHONE' ? s.ap : null;
}

/**
 * 모의 본인인증: 6자리 인증번호를 만들어 서명 쿠키에 두고 화면에 보여 준다.
 * 임시 테스트 모드면 인증번호 없이 바로 인증 완료로 처리한다.
 */
export async function beginMockPhone(name: string, phone: string): Promise<{ mockCode: string } | { verified: AuthStep }> {
  if (identityDriver() !== 'mock') throw new UserError('본인인증 창에서 인증해 주세요.');
  if (identityAutoVerify()) return { verified: await afterPhoneVerified(phone, name) };
  const code = generateMockCode();
  await setSealedCookie(PHONE_CHALLENGE_COOKIE, { p: seal(phone), n: seal(name), c: code, t: 0 }, CHALLENGE_TTL);
  return { mockCode: code };
}

export async function confirmMockPhone(phone: string, code: string) {
  const ch = await readSealedCookie<Challenge>(PHONE_CHALLENGE_COOKIE);
  if (!ch || open(ch.p) !== phone) throw new UserError('인증번호를 다시 받아 주세요.');
  if (ch.t >= MAX_TRIES) {
    await clearCookie(PHONE_CHALLENGE_COOKIE);
    throw new UserError('인증번호를 여러 번 틀렸습니다. 인증번호를 다시 받아 주세요.');
  }
  if (ch.c !== code) {
    await setSealedCookie(PHONE_CHALLENGE_COOKIE, { ...ch, t: ch.t + 1 }, CHALLENGE_TTL);
    throw new UserError('인증번호가 맞지 않습니다.');
  }
  await clearCookie(PHONE_CHALLENGE_COOKIE);
  return afterPhoneVerified(phone, open(ch.n));
}

/** 포트원 본인인증 결과 확인 */
export async function confirmPortOneIdentity(identityVerificationId: string) {
  const r = await createIdentityVerifier().verify(identityVerificationId);
  if (!r.ok) throw new UserError(r.reason);
  return afterPhoneVerified(r.phone.replace(/[^0-9]/g, ''), r.name);
}

export type AuthStep = { step: 'DONE'; linked: boolean } | { step: 'TERMS' };

/** 휴대폰 인증 완료 → 기존 고객이면 로그인(필요 시 로그인 수단 연결), 신규면 약관 동의로 */
async function afterPhoneVerified(phone: string, name: string | null): Promise<AuthStep> {
  const pending = await readSealedCookie<Signup>(SIGNUP_COOKIE);
  if (!isDbConfigured()) {
    await clearCookie(SIGNUP_COOKIE);
    await startCustomerSession(DEMO_CUSTOMER_ID);
    return { step: 'DONE', linked: false };
  }
  const existing = await findCustomerByPhone(phone);
  if (existing) {
    const social = pending && pending.ap !== 'PHONE' ? pending : null;
    // 전화 접수만 있던 고객(로그인 수단 없음)이나 소셜 연결 → 기존 레코드에 연결(F-CUS-AUTH-04)
    const linked = !existing.authProvider;
    if (social) await linkAppLogin(existing.id, social.ap, social.ak);
    else if (!existing.authProvider || existing.status !== 'ACTIVE') await linkAppLogin(existing.id, existing.authProvider ?? 'PHONE', null);
    await clearCookie(SIGNUP_COOKIE);
    await startCustomerSession(existing.id);
    return { step: 'DONE', linked };
  }
  await setSealedCookie(
    SIGNUP_COOKIE,
    { p: seal(phone), n: seal(name ?? open(pending?.n) ?? null), ap: pending?.ap ?? 'PHONE', ak: pending?.ak ?? null },
    SIGNUP_TTL,
  );
  return { step: 'TERMS' };
}

/** C-AUTH-020 진입 가능 여부 (휴대폰 인증을 마친 가입 진행 중) */
export async function hasVerifiedSignup() {
  const s = await readSealedCookie<Signup>(SIGNUP_COOKIE);
  return Boolean(s?.p);
}

/** F-CUS-AUTH-01·03 약관 동의 → 고객 생성 + 동의 이력 → 로그인 */
export async function completeSignup(consents: ConsentState, nameInput: string | null) {
  const s = await readSealedCookie<Signup>(SIGNUP_COOKIE);
  const phone = open(s?.p);
  if (!s || !phone) throw new UserError('휴대폰 인증을 먼저 해 주세요.');
  const err = validateSignupConsents(consents);
  if (err) throw new UserError(err);
  const name = (nameInput ?? open(s.n) ?? '').trim();
  if (!name) throw new UserError('이름은(는) 필수 입력값입니다.');
  // 그사이 같은 번호로 가입된 경우(다른 기기 등)는 기존 고객으로 로그인
  const existing = await findCustomerByPhone(phone);
  const id =
    existing?.id ??
    (await createCustomer({ name, phone, joinChannel: 'APP', authProvider: s.ap, authProviderKey: s.ak, consents }));
  await clearCookie(SIGNUP_COOKIE);
  await startCustomerSession(id);
}

/** 소셜 로그인 콜백: 이미 연결된 고객이면 로그인, 아니면 휴대폰 인증으로 (같은 고객으로 묶기 위해) */
export async function afterSocialLogin(provider: string, providerKey: string, name: string | null): Promise<'DONE' | 'PHONE'> {
  if (!isDbConfigured()) {
    await startCustomerSession(DEMO_CUSTOMER_ID);
    return 'DONE';
  }
  const found = await findCustomerBySocial(provider, providerKey);
  if (found) {
    await startCustomerSession(found.id);
    return 'DONE';
  }
  await setSealedCookie(SIGNUP_COOKIE, { p: null, n: seal(name), ap: provider, ak: providerKey }, SIGNUP_TTL);
  return 'PHONE';
}
