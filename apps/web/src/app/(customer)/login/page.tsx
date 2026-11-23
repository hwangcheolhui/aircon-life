// C-AUTH-010 로그인 · F-CUS-AUTH-01: 소셜 로그인(카카오·네이버·애플) + 휴대폰 로그인 + 둘러보기
import { type SocialProviderCode, SOCIAL_PROVIDERS, createSocialProvider } from '@aircon/integrations';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentCustomer, safeNext } from '@/server/customer-session';
import { loadCodes } from '@/server/codes';

export const metadata = { title: '로그인' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await getCurrentCustomer()) redirect(next);
  const codes = await loadCodes(['AUTH_PROVIDER']);
  const label = (p: string) => codes.AUTH_PROVIDER?.find((c) => c.value === p)?.label ?? p;
  // 키가 없거나 아직 실연동이 없는 공급자(애플)는 버튼을 숨긴다
  const socials = SOCIAL_PROVIDERS.filter((p: SocialProviderCode) => createSocialProvider(p) !== null);
  const q = `?next=${encodeURIComponent(next)}`;
  return (
    <section className="cus-auth">
      <h1 className="ac-h2">로그인하고 예약을 이어가세요</h1>
      <p className="ac-body">처음이면 휴대폰 인증 후 약관 동의만 하면 가입이 끝나요. 전화로 예약한 적이 있다면 같은 번호로 인증하면 이전 이력이 이어져요.</p>
      {socials.map((p) => (
        <a key={p} href={`/auth/${p.toLowerCase()}${q}`} className="ac-btn ac-btn--outline ac-btn--lg ac-btn--block">
          {label(p)}로 계속하기
        </a>
      ))}
      <Link href={`/login/phone${q}`} className="ac-btn ac-btn--primary ac-btn--lg ac-btn--block">
        휴대폰 번호로 계속하기
      </Link>
      <Link href="/" className="ac-btn ac-btn--ghost ac-btn--block">
        둘러보기
      </Link>
    </section>
  );
}
