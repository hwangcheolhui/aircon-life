import 'server-only';
/**
 * 기사 앱 로그인 (F-TEC-AUTH-01, T-AUTH-010). 휴대폰 번호 + 비밀번호 또는 인증번호(OTP).
 * - 세션: 서버가 서명한 httpOnly 쿠키(ac_tech)에 기사 ID만 담는다. 고객 세션과 같은 서명 방식(customer-session)이다.
 *   유효기간 TECH_SESSION_DAYS(기본 30일, "자동로그인"). 관리자 인증(Supabase Auth)과는 분리된다.
 * - 로그인 ID: technician.login_id = 휴대폰 번호 검색용 해시(평문 번호를 두지 않음). 해시가 비어 있는 단계 2 등록 기사는
 *   로그인 때 한 번 연락처를 복호화해 찾고 해시를 채운다.
 * - 인증번호: 고객 휴대폰 인증과 같은 본인인증 어댑터(IDENTITY_DRIVER). 모의(mock)는 화면에 인증번호를 보여 주고,
 *   임시 테스트 모드(IDENTITY_MOCK_AUTO_VERIFY=true)면 [인증번호 받기]만으로 로그인된다. 운영 전 반드시 끈다.
 * - 비밀번호 연속 실패 TECH_LOGIN_MAX_FAIL 회면 비밀번호 로그인이 잠기고, 인증번호 로그인에 성공하면 풀린다.
 * 상태 ACTIVE·TRAINING 기사만 로그인한다(evaluateTechLogin).
 */
import { technician } from '@aircon/db';
import { SETTING_KEYS, TECH_LOGIN_MESSAGES, evaluateTechLogin, normalizePhone } from '@aircon/domain';
import { hashPassword, verifyPassword } from '@aircon/domain/server';
import { createIdentityVerifier, generateMockCode } from '@aircon/integrations';
import { and, eq, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { UserError } from './action-result';
import { identityAutoVerify, identityDriver } from './customer-auth';
import { clearCookie, readSealedCookie, setSealedCookie } from './customer-session';
import { getDb, isDbConfigured } from './db';
import { decrypt, encrypt, phoneHash } from './pii';
import { getSettingNumber } from './settings';

export const TECH_COOKIE = 'ac_tech';
const TECH_CHALLENGE_COOKIE = 'ac_tech_otp';
const CHALLENGE_TTL = 3 * 60;
const MAX_TRIES = 5;

const sessionDays = () => Number(process.env.TECH_SESSION_DAYS ?? 30);

export interface CurrentTech {
  id: number;
  techCode: string;
  name: string;
  branchId: number;
  grade: string;
  status: string;
}

/** 로그인한 기사 (로그인 가능 상태만). 없으면 null */
export const getCurrentTech = cache(async (): Promise<CurrentTech | null> => {
  if (!isDbConfigured()) return null;
  const s = await readSealedCookie<{ tid: number }>(TECH_COOKIE);
  if (!s?.tid) return null;
  const [t] = await getDb()
    .select({ id: technician.id, techCode: technician.techCode, name: technician.name, branchId: technician.branchId, grade: technician.grade, status: technician.status })
    .from(technician)
    .where(and(eq(technician.id, s.tid), isNull(technician.deletedAt)));
  if (!t || !['ACTIVE', 'TRAINING'].includes(t.status)) return null;
  return t;
});

/** 기사 화면 가드: 비로그인 → T-AUTH-010 */
export async function requireTech(): Promise<CurrentTech> {
  const t = await getCurrentTech();
  if (!t) redirect('/tech/login');
  return t;
}

/** 기사 서버 액션 가드 */
export async function requireTechAction(): Promise<CurrentTech> {
  const t = await getCurrentTech();
  if (!t) throw new UserError('로그인이 필요합니다. 다시 로그인해 주세요.');
  return t;
}

async function startSession(id: number) {
  await setSealedCookie(TECH_COOKIE, { tid: id }, sessionDays() * 24 * 60 * 60);
}
export async function endTechSession() {
  await clearCookie(TECH_COOKIE);
}

/** 휴대폰 번호로 기사 찾기 (login_id 해시, 없으면 해시가 빈 기사의 연락처를 복호화해 찾고 해시를 채운다) */
async function findTechByPhone(phone: string) {
  const db = getDb();
  const hash = phoneHash(phone);
  const [hit] = await db.select().from(technician).where(eq(technician.loginId, hash));
  if (hit) return hit;
  const legacy = await db.select().from(technician).where(and(isNull(technician.loginId), isNull(technician.deletedAt)));
  const want = normalizePhone(phone);
  const found = legacy.find((t) => normalizePhone(decrypt(t.phone) ?? '') === want);
  if (!found) return null;
  await db.update(technician).set({ loginId: hash }).where(eq(technician.id, found.id));
  return { ...found, loginId: hash };
}

const fail = (r: keyof typeof TECH_LOGIN_MESSAGES): never => {
  throw new UserError(TECH_LOGIN_MESSAGES[r]);
};

/** 비밀번호 로그인 */
export async function techPasswordLogin(phone: string, password: string) {
  if (!isDbConfigured()) throw new UserError('기사 앱은 DB를 연결한 뒤 사용할 수 있습니다.');
  const t = await findTechByPhone(phone);
  if (!t) fail('INVALID');
  const maxFail = await getSettingNumber(SETTING_KEYS.TECH_LOGIN_MAX_FAIL);
  const ok = Boolean(t!.passwordHash) && verifyPassword(password, t!.passwordHash!);
  const r = evaluateTechLogin(
    { status: t!.status, deleted: t!.deletedAt !== null, loginFailCount: t!.loginFailCount, hasPassword: Boolean(t!.passwordHash) },
    'PASSWORD',
    ok,
    maxFail,
  );
  if (r.result === 'INVALID' || r.result === 'LOCKED') {
    if (r.loginFailCount !== t!.loginFailCount) await getDb().update(technician).set({ loginFailCount: r.loginFailCount }).where(eq(technician.id, t!.id));
    fail(r.result);
  }
  if (r.result !== 'SUCCESS') fail(r.result);
  if (t!.loginFailCount) await getDb().update(technician).set({ loginFailCount: 0 }).where(eq(technician.id, t!.id));
  await startSession(t!.id);
}

/** 인증번호 로그인 성공 처리 (실패 횟수 초기화) */
async function afterOtpVerified(phone: string) {
  const t = await findTechByPhone(phone);
  if (!t) throw new UserError('등록된 기사 번호가 아닙니다. 거점에 문의해 주세요.');
  const r = evaluateTechLogin({ status: t.status, deleted: t.deletedAt !== null, loginFailCount: t.loginFailCount, hasPassword: Boolean(t.passwordHash) }, 'OTP', true, 0);
  if (r.result !== 'SUCCESS') fail(r.result);
  if (t.loginFailCount) await getDb().update(technician).set({ loginFailCount: 0 }).where(eq(technician.id, t.id));
  await startSession(t.id);
}

/** 인증번호 받기 (모의). 임시 테스트 모드면 바로 로그인한다 */
export async function beginTechOtp(phone: string): Promise<{ mockCode: string } | { done: true }> {
  if (!isDbConfigured()) throw new UserError('기사 앱은 DB를 연결한 뒤 사용할 수 있습니다.');
  if (identityDriver() !== 'mock') throw new UserError('본인인증 창에서 인증해 주세요.');
  if (identityAutoVerify()) {
    await afterOtpVerified(phone);
    return { done: true };
  }
  // 등록되지 않은 번호에는 인증번호를 만들지 않는다
  if (!(await findTechByPhone(phone))) throw new UserError('등록된 기사 번호가 아닙니다. 거점에 문의해 주세요.');
  const code = generateMockCode();
  await setSealedCookie(TECH_CHALLENGE_COOKIE, { p: encrypt(phone), c: code, t: 0 }, CHALLENGE_TTL);
  return { mockCode: code };
}

export async function confirmTechOtp(phone: string, code: string) {
  const ch = await readSealedCookie<{ p: string; c: string; t: number }>(TECH_CHALLENGE_COOKIE);
  if (!ch || decrypt(ch.p) !== phone) throw new UserError('인증번호를 다시 받아 주세요.');
  if (ch.t >= MAX_TRIES) {
    await clearCookie(TECH_CHALLENGE_COOKIE);
    throw new UserError('인증번호를 여러 번 틀렸습니다. 인증번호를 다시 받아 주세요.');
  }
  if (ch.c !== code) {
    await setSealedCookie(TECH_CHALLENGE_COOKIE, { ...ch, t: ch.t + 1 }, CHALLENGE_TTL);
    throw new UserError('인증번호가 맞지 않습니다.');
  }
  await clearCookie(TECH_CHALLENGE_COOKIE);
  await afterOtpVerified(phone);
}

/** 포트원 본인인증 결과로 로그인 */
export async function confirmTechIdentity(identityVerificationId: string) {
  const r = await createIdentityVerifier().verify(identityVerificationId);
  if (!r.ok) throw new UserError(r.reason);
  await afterOtpVerified(r.phone.replace(/[^0-9]/g, ''));
}

/** T-MY-010 비밀번호 만들기·바꾸기 (로그인한 본인) */
export async function setTechPassword(techId: number, plain: string) {
  await getDb().update(technician).set({ passwordHash: hashPassword(plain), loginFailCount: 0, updatedAt: new Date(), updatedBy: techId }).where(eq(technician.id, techId));
}
