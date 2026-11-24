/**
 * 현금영수증 발행 (F-ADM-PAY-05 · F-TEC-PAY-03 · F-CUS-PAY-03). CLAUDE.md §7 인터페이스 + Mock + Real.
 * - Mock: 바로 발행된 것으로 보고 승인번호 MOCK-… 를 돌려준다. 발급 번호가 "0000"으로 끝나면 실패를 흉내 낸다(시험용).
 * - Real: 포트원 V2 현금영수증 수동 발급(POST /cash-receipts)·취소(POST /payments/{id}/cash-receipt/cancel).
 *   본문 필드는 포트원 문서 기준이며, 실연동 전 테스트 상점에서 한 번 확인해야 한다(04 §0 원칙 4).
 * - 세금계산서(TAX_INVOICE)는 홈택스·회계 프로그램에서 발행하고 승인번호만 관리자 화면(A-PAY-050)에 입력한다.
 * 전환: RECEIPT_DRIVER=portone|mock (기본 mock). Real 은 PORTONE_API_SECRET·PORTONE_STORE_ID·PORTONE_CASH_RECEIPT_CHANNEL_KEY 필요.
 */

export interface CashReceiptRequest {
  /** 우리 쪽 발급 건 ID (포트원 paymentId 자리) */
  receiptId: string;
  /** INCOME = 소득공제(개인), EXPENSE = 지출증빙(사업자) */
  purpose: 'INCOME' | 'EXPENSE';
  /** 휴대폰·사업자번호(숫자만) */
  identityNo: string;
  totalAmount: number;
  vatAmount: number;
  orderName: string;
}

export interface CashReceiptResult {
  ok: boolean;
  issuedNo: string | null;
  failReason: string | null;
}

export interface ReceiptIssuer {
  kind: 'mock' | 'portone';
  issueCashReceipt(r: CashReceiptRequest): Promise<CashReceiptResult>;
  cancelCashReceipt(receiptId: string): Promise<{ ok: boolean; failReason: string | null }>;
}

export type ReceiptDriver = 'mock' | 'portone';
export const resolveReceiptDriver = (v: string | undefined): ReceiptDriver =>
  v === 'portone' ? 'portone' : 'mock';

export function createMockReceiptIssuer(): ReceiptIssuer {
  return {
    kind: 'mock',
    async issueCashReceipt(r) {
      if (r.identityNo.endsWith('0000'))
        return { ok: false, issuedNo: null, failReason: '모의 발행 실패(테스트)' };
      return { ok: true, issuedNo: `MOCK-${r.receiptId}`, failReason: null };
    },
    async cancelCashReceipt() {
      return { ok: true, failReason: null };
    },
  };
}

const PORTONE_API = 'https://api.portone.io';

export function createPortOneReceiptIssuer(opts: {
  apiSecret: string;
  storeId: string;
  channelKey: string;
  fetchImpl?: typeof fetch;
}): ReceiptIssuer {
  const f = opts.fetchImpl ?? fetch;
  if (!opts.apiSecret || !opts.channelKey)
    throw new Error('PORTONE_API_SECRET·PORTONE_CASH_RECEIPT_CHANNEL_KEY가 설정되지 않았습니다.');
  const headers = { Authorization: `PortOne ${opts.apiSecret}`, 'Content-Type': 'application/json' };
  return {
    kind: 'portone',
    async issueCashReceipt(r) {
      const res = await f(`${PORTONE_API}/cash-receipts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          storeId: opts.storeId || undefined,
          paymentId: r.receiptId,
          channelKey: opts.channelKey,
          type: r.purpose === 'INCOME' ? 'PERSONAL' : 'CORPORATE',
          orderName: r.orderName,
          currency: 'KRW',
          amount: { total: r.totalAmount, vat: r.vatAmount },
          productType: 'DIGITAL',
          customer: { identityNumber: r.identityNo },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        cashReceipt?: { status?: string; issueNumber?: string; failure?: { reason?: string } };
        message?: string;
      };
      const c = body.cashReceipt;
      if (res.ok && c?.status === 'ISSUED')
        return { ok: true, issuedNo: c.issueNumber ?? null, failReason: null };
      return {
        ok: false,
        issuedNo: null,
        failReason: c?.failure?.reason ?? body.message ?? `현금영수증 발급 실패(${res.status})`,
      };
    },
    async cancelCashReceipt(receiptId) {
      const res = await f(`${PORTONE_API}/payments/${encodeURIComponent(receiptId)}/cash-receipt/cancel`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ storeId: opts.storeId || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return res.ok
        ? { ok: true, failReason: null }
        : { ok: false, failReason: body.message ?? `현금영수증 취소 실패(${res.status})` };
    },
  };
}

export function createReceiptIssuer(env: NodeJS.ProcessEnv = process.env): ReceiptIssuer {
  return resolveReceiptDriver(env.RECEIPT_DRIVER) === 'portone'
    ? createPortOneReceiptIssuer({
        apiSecret: env.PORTONE_API_SECRET ?? '',
        storeId: env.PORTONE_STORE_ID ?? '',
        channelKey: env.PORTONE_CASH_RECEIPT_CHANNEL_KEY ?? '',
      })
    : createMockReceiptIssuer();
}
