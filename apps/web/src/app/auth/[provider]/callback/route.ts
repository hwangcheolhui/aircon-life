// C-AUTH-010 소셜 로그인 콜백 · F-CUS-AUTH-01: 연결된 고객이면 로그인, 처음이면 휴대폰 인증(C-AUTH-030)으로
import { type SocialProviderCode, createSocialProvider } from '@aircon/integrations';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { afterSocialLogin } from '@/server/customer-auth';
import { SOCIAL_STATE_COOKIE, clearCookie, readSealedCookie } from '@/server/customer-session';

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const code = (await params).provider.toUpperCase() as SocialProviderCode;
  const st = await readSealedCookie<{ s: string; p: string; next: string }>(SOCIAL_STATE_COOKIE);
  await clearCookie(SOCIAL_STATE_COOKIE);
  const authCode = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const provider = createSocialProvider(code);
  if (!st || st.p !== code || st.s !== state || !authCode || !provider) redirect('/login?error=social');
  let result: 'DONE' | 'PHONE';
  try {
    const profile = await provider.exchange(authCode, `${req.nextUrl.origin}/auth/${code.toLowerCase()}/callback`, state);
    result = await afterSocialLogin(code, profile.providerKey, profile.name);
  } catch (e) {
    console.error('소셜 로그인 실패', code, e);
    redirect('/login?error=social');
  }
  redirect(result === 'DONE' ? st.next : `/login/phone?next=${encodeURIComponent(st.next)}`);
}
