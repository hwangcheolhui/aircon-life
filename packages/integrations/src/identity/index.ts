/**
 * 휴대폰 본인인증 (F-CUS-AUTH-01·02·04). CLAUDE.md §7 인터페이스 + Mock + Real.
 * - Real: 포트원 V2 본인인증(결제와 같은 SDK, 06 §4.2). 브라우저 인증창이 끝나면 서버가 인증 ID로 포트원 API에 결과(이름·휴대폰)를 확인한다.
 * - Mock: 화면에 보이는 6자리 인증번호를 입력한다(개발·E2E). 인증번호는 서버가 서명한 쿠키로 확인한다.
 * 전환: IDENTITY_DRIVER=portone|mock (기본 mock). Real 은 PORTONE_API_SECRET·PORTONE_STORE_ID·PORTONE_IDENTITY_CHANNEL_KEY 필요.
 * 임시 테스트 모드: IDENTITY_DRIVER=mock 이고 IDENTITY_MOCK_AUTO_VERIFY=true 면 [인증번호 받기]만 눌러도 인증 완료로 본다
 * (본인인증 키 발급 전 구현 기간 한정, 02 §7). portone 에서는 무시한다. 운영 전 반드시 끈다.
 */

export type IdentityDriver = 'mock' | 'portone';
export const resolveIdentityDriver = (v: string | undefined): IdentityDriver => (v === 'portone' ? 'portone' : 'mock');

export type IdentityResult = { ok: true; phone: string; name: string | null } | { ok: false; reason: string };

export interface IdentityVerifier {
  kind: IdentityDriver;
  /** 포트원 본인인증 ID → 인증된 휴대폰·이름 */
  verify(identityVerificationId: string): Promise<IdentityResult>;
}

export function createPortOneIdentityVerifier(opts: { apiSecret: string; fetchImpl?: typeof fetch }): IdentityVerifier {
  const f = opts.fetchImpl ?? fetch;
  if (!opts.apiSecret) throw new Error('PORTONE_API_SECRET이 설정되지 않았습니다.');
  return {
    kind: 'portone',
    async verify(id) {
      const res = await f(`https://api.portone.io/identity-verifications/${encodeURIComponent(id)}`, {
        headers: { Authorization: `PortOne ${opts.apiSecret}` },
      });
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        verifiedCustomer?: { name?: string; phoneNumber?: string };
        message?: string;
      };
      if (!res.ok || body.status !== 'VERIFIED' || !body.verifiedCustomer?.phoneNumber) {
        return { ok: false, reason: body.message ?? '본인인증이 완료되지 않았습니다.' };
      }
      return { ok: true, phone: body.verifiedCustomer.phoneNumber, name: body.verifiedCustomer.name ?? null };
    },
  };
}

/** Mock: 실제 확인은 화면 인증번호(서명 쿠키)로 하므로 포트원 ID 확인은 쓰지 않는다 */
export function createMockIdentityVerifier(): IdentityVerifier {
  return {
    kind: 'mock',
    async verify() {
      return { ok: false, reason: '모의 인증에서는 인증번호를 입력해 주세요.' };
    },
  };
}

export function createIdentityVerifier(env: NodeJS.ProcessEnv = process.env): IdentityVerifier {
  return resolveIdentityDriver(env.IDENTITY_DRIVER) === 'portone'
    ? createPortOneIdentityVerifier({ apiSecret: env.PORTONE_API_SECRET ?? '' })
    : createMockIdentityVerifier();
}

/** 임시 테스트 모드(인증번호 입력 생략) 여부 — mock 드라이버에서만 켜진다 */
export const isIdentityAutoVerify = (env: { IDENTITY_DRIVER?: string; IDENTITY_MOCK_AUTO_VERIFY?: string }): boolean =>
  resolveIdentityDriver(env.IDENTITY_DRIVER) === 'mock' && env.IDENTITY_MOCK_AUTO_VERIFY === 'true';

/** 모의 인증번호 6자리 */
export function generateMockCode(random: () => number = Math.random): string {
  return String(Math.floor(random() * 1_000_000)).padStart(6, '0');
}
