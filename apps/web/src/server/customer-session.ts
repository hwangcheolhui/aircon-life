import 'server-only';
/**
 * 고객 로그인 세션 (F-CUS-AUTH-01). 휴대폰 본인인증 또는 소셜 로그인으로 고객을 확인한 뒤
 * 서버가 서명한(HMAC-SHA256) httpOnly 쿠키에 고객 ID만 담는다. 관리자 인증(Supabase Auth)과 분리된 고객 전용 세션이다(06 §2.3).
 * 비밀키: CUSTOMER_SESSION_SECRET (없으면 SESSION_SECRET). 유효기간: CUSTOMER_SESSION_DAYS(기본 30일).
 *
 * 같은 방식으로 "가입 진행 중" 토큰(본인인증은 끝났지만 약관 동의 전)과 모의 인증번호 확인 토큰도 서명한다.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { customer } from '@aircon/db';
import { and, eq, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb, isDbConfigured } from './db';

export const CUSTOMER_COOKIE = 'ac_customer';
export const SIGNUP_COOKIE = 'ac_signup';
export const PHONE_CHALLENGE_COOKIE = 'ac_phone_challenge';
export const SOCIAL_STATE_COOKIE = 'ac_social_state';

/** 체험 모드(DB 미연결) 고객: 저장하지 않으므로 ID 0 */
export const DEMO_CUSTOMER_ID = 0;

function secret(): string {
  const s = process.env.CUSTOMER_SESSION_SECRET || process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  // 체험 모드는 저장하는 데이터가 없으므로 고정 키로 동작한다(DB를 연결하면 반드시 비밀키 필요)
  if (!isDbConfigured()) return 'demo-only-customer-session-key';
  throw new Error('CUSTOMER_SESSION_SECRET(16자 이상)이 필요합니다.');
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function seal(data: Record<string, unknown>, ttlSec: number): string {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + ttlSec * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function unseal<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sign(payload));
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as T & { exp: number };
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

export async function setSealedCookie(name: string, data: Record<string, unknown>, ttlSec: number) {
  (await cookies()).set(name, seal(data, ttlSec), cookieOpts(ttlSec));
}
export async function readSealedCookie<T>(name: string): Promise<T | null> {
  return unseal<T>((await cookies()).get(name)?.value);
}
export async function clearCookie(name: string) {
  (await cookies()).set(name, '', { ...cookieOpts(0), maxAge: 0 });
}

const sessionDays = () => Number(process.env.CUSTOMER_SESSION_DAYS ?? 30);

export async function startCustomerSession(customerId: number, name?: string) {
  await setSealedCookie(CUSTOMER_COOKIE, { cid: customerId, ...(name ? { n: name } : {}) }, sessionDays() * 24 * 60 * 60);
}
export async function endCustomerSession() {
  await clearCookie(CUSTOMER_COOKIE);
}

export interface CurrentCustomer {
  id: number;
  customerNo: string;
  /** 체험 모드 고객 (저장하지 않음) */
  demo: boolean;
}

/** 로그인한 고객 (정상 상태만). 없으면 null */
export const getCurrentCustomer = cache(async (): Promise<CurrentCustomer | null> => {
  const s = await readSealedCookie<{ cid: number }>(CUSTOMER_COOKIE);
  if (!s) return null;
  if (!isDbConfigured()) return s.cid === DEMO_CUSTOMER_ID ? { id: DEMO_CUSTOMER_ID, customerNo: '체험', demo: true } : null;
  const [row] = await getDb()
    .select({ id: customer.id, customerNo: customer.customerNo })
    .from(customer)
    .where(and(eq(customer.id, s.cid), eq(customer.status, 'ACTIVE'), isNull(customer.deletedAt)));
  return row ? { ...row, demo: false } : null;
});

/** 로그인이 필요한 고객 화면 가드: 없으면 휴대폰 인증(C-AUTH-030)으로 보내고 끝나면 돌아온다 */
export async function requireCustomer(next: string): Promise<CurrentCustomer> {
  const c = await getCurrentCustomer();
  if (!c) redirect(`/login?next=${encodeURIComponent(next)}`);
  return c;
}

/** 로그인 후 돌아갈 경로: 같은 사이트 경로만 허용 (오픈 리다이렉트 방지) */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/admin')) return fallback;
  return next;
}
