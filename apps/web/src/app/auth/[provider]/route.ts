// C-AUTH-010 소셜 로그인 시작 · F-CUS-AUTH-01: 공급자 로그인 화면으로 보낸다 (state 는 서명 쿠키로 위조 방지)
import { type SocialProviderCode, SOCIAL_PROVIDERS, createSocialProvider } from '@aircon/integrations';
import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { SOCIAL_STATE_COOKIE, safeNext, setSealedCookie } from '@/server/customer-session';

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const code = (await params).provider.toUpperCase() as SocialProviderCode;
  const provider = SOCIAL_PROVIDERS.includes(code) ? createSocialProvider(code) : null;
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  if (!provider) redirect(`/login?next=${encodeURIComponent(next)}`);
  const state = randomBytes(16).toString('base64url');
  await setSealedCookie(SOCIAL_STATE_COOKIE, { s: state, p: code, next }, 10 * 60);
  redirect(provider.authorizeUrl(state, `${req.nextUrl.origin}/auth/${code.toLowerCase()}/callback`));
}
