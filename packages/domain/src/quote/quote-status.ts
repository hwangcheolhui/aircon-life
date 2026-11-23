/**
 * 견적 상태 전이·유효기간·번호 (01 §2.4.1 quote, §3.8 견적 상태, BR-015, F-SYS-02).
 * quote.status 변경은 이 전이표를 거친다(CLAUDE.md §5).
 */

export const QUOTE_STATUSES = ['DRAFT', 'ISSUED', 'CONVERTED', 'EXPIRED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** 01 §3.8 다음 가능 상태 */
export const QUOTE_TRANSITIONS: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  DRAFT: ['ISSUED', 'EXPIRED'],
  ISSUED: ['CONVERTED', 'EXPIRED'],
  CONVERTED: [],
  EXPIRED: [],
};

export function canTransitionQuote(from: string, to: QuoteStatus): boolean {
  return (QUOTE_TRANSITIONS[from as QuoteStatus] ?? []).includes(to);
}

export function assertQuoteTransition(from: string, to: QuoteStatus): void {
  if (!canTransitionQuote(from, to)) throw new Error(`견적 상태를 ${from}에서 ${to}(으)로 바꿀 수 없습니다.`);
}

/** F-SYS-02 만료 배치가 EXPIRED 로 바꿀 수 있는 상태 (전이표에서 파생) */
export const QUOTE_EXPIRABLE_STATUSES: readonly QuoteStatus[] = QUOTE_STATUSES.filter((s) =>
  canTransitionQuote(s, 'EXPIRED'),
);

/** BR-015 유효기한 = 발행 시각 + QUOTE_EXPIRE_DAYS(system_setting)일 */
export function quoteExpiresAt(issuedAt: Date, expireDays: number): Date {
  if (!Number.isInteger(expireDays) || expireDays < 1)
    throw new Error('견적 유효기간(QUOTE_EXPIRE_DAYS)은 1 이상 정수여야 합니다.');
  return new Date(issuedAt.getTime() + expireDays * 24 * 60 * 60 * 1000);
}

/** BR-015 유효기한이 지났고 아직 만료 처리 전인 견적인지 (배치 전에도 화면에서 만료로 보여 준다) */
export function isQuoteExpired(q: { status: string; expiresAt: Date | null }, now: Date): boolean {
  if (q.status === 'EXPIRED') return true;
  if (!canTransitionQuote(q.status, 'EXPIRED') || !q.expiresAt) return false;
  return q.expiresAt.getTime() < now.getTime();
}

/** 한국 시간 기준 YYMMDD */
export function kstYymmdd(at: Date): string {
  const s = at.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD
  return s.slice(2, 4) + s.slice(5, 7) + s.slice(8, 10);
}

/** 한국 시간 기준 YYYY-MM-DD */
export function kstDate(at: Date): string {
  return at.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/** 견적 번호 `Q2611220001` = Q + YYMMDD(한국 날짜) + 그날 4자리 일련번호 (01 §2.4.1) */
export function formatQuoteNo(at: Date, seq: number): string {
  return `Q${kstYymmdd(at)}${String(seq).padStart(4, '0')}`;
}
