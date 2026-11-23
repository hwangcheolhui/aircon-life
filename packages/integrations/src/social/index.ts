/**
 * 소셜 로그인 (F-CUS-AUTH-01). CLAUDE.md §7 인터페이스 + Mock + Real. 06 §4.4: 카카오·네이버는 OAuth 직접 연동, 애플은 iOS 앱 출시 때.
 * - Real: 카카오(KAKAO_REST_API_KEY[, KAKAO_CLIENT_SECRET]) · 네이버(NAVER_CLIENT_ID, NAVER_CLIENT_SECRET). 애플은 아직 Real 없음(버튼 숨김).
 * - Mock: 공급자 로그인 화면 없이 바로 콜백으로 돌아와 고정된 예시 계정 키를 준다(개발·E2E).
 * 전환: SOCIAL_DRIVER=real|mock (기본 mock)
 */

export type SocialProviderCode = 'KAKAO' | 'NAVER' | 'APPLE';
export const SOCIAL_PROVIDERS: readonly SocialProviderCode[] = ['KAKAO', 'NAVER', 'APPLE'];

export interface SocialProfile {
  /** customer.auth_provider_key */
  providerKey: string;
  name: string | null;
  phone: string | null;
}

export interface SocialProvider {
  provider: SocialProviderCode;
  kind: 'mock' | 'real';
  authorizeUrl(state: string, redirectUri: string): string;
  exchange(code: string, redirectUri: string, state: string): Promise<SocialProfile>;
}

export function createMockSocialProvider(provider: SocialProviderCode): SocialProvider {
  return {
    provider,
    kind: 'mock',
    authorizeUrl: (state, redirectUri) =>
      `${redirectUri}?code=${encodeURIComponent(`mock-${provider.toLowerCase()}`)}&state=${encodeURIComponent(state)}`,
    async exchange(code) {
      if (!code.startsWith('mock-')) throw new Error('모의 로그인 코드가 아닙니다.');
      return { providerKey: `mock-${provider.toLowerCase()}-user`, name: null, phone: null };
    },
  };
}

function form(o: Record<string, string>) {
  return new URLSearchParams(o).toString();
}

export function createKakaoProvider(o: { clientId: string; clientSecret?: string; fetchImpl?: typeof fetch }): SocialProvider {
  const f = o.fetchImpl ?? fetch;
  return {
    provider: 'KAKAO',
    kind: 'real',
    authorizeUrl: (state, redirectUri) =>
      `https://kauth.kakao.com/oauth/authorize?${form({ client_id: o.clientId, redirect_uri: redirectUri, response_type: 'code', state })}`,
    async exchange(code, redirectUri) {
      const tokenRes = await f('https://kauth.kakao.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: form({
          grant_type: 'authorization_code',
          client_id: o.clientId,
          redirect_uri: redirectUri,
          code,
          ...(o.clientSecret ? { client_secret: o.clientSecret } : {}),
        }),
      });
      const token = (await tokenRes.json()) as { access_token?: string };
      if (!token.access_token) throw new Error('카카오 로그인에 실패했습니다.');
      const me = (await (
        await f('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: `Bearer ${token.access_token}` } })
      ).json()) as { id?: number; kakao_account?: { name?: string; phone_number?: string } };
      if (!me.id) throw new Error('카카오 사용자 정보를 받지 못했습니다.');
      return { providerKey: String(me.id), name: me.kakao_account?.name ?? null, phone: me.kakao_account?.phone_number ?? null };
    },
  };
}

export function createNaverProvider(o: { clientId: string; clientSecret: string; fetchImpl?: typeof fetch }): SocialProvider {
  const f = o.fetchImpl ?? fetch;
  return {
    provider: 'NAVER',
    kind: 'real',
    authorizeUrl: (state, redirectUri) =>
      `https://nid.naver.com/oauth2.0/authorize?${form({ response_type: 'code', client_id: o.clientId, redirect_uri: redirectUri, state })}`,
    async exchange(code, _redirectUri, state) {
      const token = (await (
        await f(
          `https://nid.naver.com/oauth2.0/token?${form({ grant_type: 'authorization_code', client_id: o.clientId, client_secret: o.clientSecret, code, state })}`,
        )
      ).json()) as { access_token?: string };
      if (!token.access_token) throw new Error('네이버 로그인에 실패했습니다.');
      const me = (await (
        await f('https://openapi.naver.com/v1/nid/me', { headers: { Authorization: `Bearer ${token.access_token}` } })
      ).json()) as { response?: { id?: string; name?: string; mobile?: string } };
      if (!me.response?.id) throw new Error('네이버 사용자 정보를 받지 못했습니다.');
      return { providerKey: me.response.id, name: me.response.name ?? null, phone: me.response.mobile ?? null };
    },
  };
}

/** 사용할 수 있는 공급자만 돌려준다 (Real 에서 키가 없거나 애플이면 null → 버튼을 숨긴다) */
export function createSocialProvider(provider: SocialProviderCode, env: NodeJS.ProcessEnv = process.env): SocialProvider | null {
  if (env.SOCIAL_DRIVER !== 'real') return createMockSocialProvider(provider);
  if (provider === 'KAKAO' && env.KAKAO_REST_API_KEY)
    return createKakaoProvider({ clientId: env.KAKAO_REST_API_KEY, clientSecret: env.KAKAO_CLIENT_SECRET || undefined });
  if (provider === 'NAVER' && env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET)
    return createNaverProvider({ clientId: env.NAVER_CLIENT_ID, clientSecret: env.NAVER_CLIENT_SECRET });
  return null;
}
