/**
 * 안심번호(가상번호) 연결 (F-CUS-ORD-02 · F-TEC-JOB-02 고객 연락, 02 §6, 단계 9). CLAUDE.md §7 인터페이스 + Mock + Real.
 * - 고객·기사가 서로 실제 번호를 보지 않고 통화하도록 주문 단위 가상번호를 받는다.
 * - Mock: 주문 번호에서 결정적으로 050-xxxx-xxxx 형식 번호를 만든다(실제 연결 없음, 저장하지 않음).
 * - Real: 통신사·안심번호 업체 선정 전이라 아직 없다. SAFE_NUMBER_DRIVER=mock 만 지원한다.
 */

export interface SafeNumberRequest {
  /** 주문 번호(order_no) */
  orderNo: string;
  /** 누가 거는가 */
  caller: 'CUSTOMER' | 'TECHNICIAN';
}

export interface SafeNumberResult {
  ok: boolean;
  /** 표시용 번호(하이픈 포함) */
  number: string | null;
  /** 유효 시각 */
  expiresAt: Date | null;
  failReason: string | null;
}

export interface SafeNumberProvider {
  kind: 'mock';
  issue(r: SafeNumberRequest, now?: Date): Promise<SafeNumberResult>;
}

export type SafeNumberDriver = 'mock';
export const resolveSafeNumberDriver = (_v: string | undefined): SafeNumberDriver => 'mock';

export function createMockSafeNumberProvider(): SafeNumberProvider {
  return {
    kind: 'mock',
    async issue(r, now = new Date()) {
      if (!r.orderNo) return { ok: false, number: null, expiresAt: null, failReason: '주문 번호가 없습니다.' };
      let h = 0;
      for (const ch of `${r.orderNo}:${r.caller}`) h = (h * 31 + ch.charCodeAt(0)) % 100_000_000;
      const d = String(h).padStart(8, '0');
      return { ok: true, number: `0504-${d.slice(0, 4)}-${d.slice(4)}`, expiresAt: new Date(now.getTime() + 24 * 3600_000), failReason: null };
    },
  };
}

export function createSafeNumberProvider(env: NodeJS.ProcessEnv = process.env): SafeNumberProvider {
  resolveSafeNumberDriver(env.SAFE_NUMBER_DRIVER);
  return createMockSafeNumberProvider();
}
