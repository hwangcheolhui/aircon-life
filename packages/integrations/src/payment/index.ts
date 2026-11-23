/**
 * PG 결제 (F-CUS-PAY-01 앱 결제, F-ADM-ORD-04 취소·환불). CLAUDE.md §7 인터페이스 + Mock + Real.
 * - Real: 포트원 V2 (하부 PG 토스페이먼츠, 06 §4.2). 브라우저 결제창(포트원 SDK)이 끝나면 서버가 결제 ID로 포트원 API에 다시 확인한다.
 * - Mock: 화면의 "모의 결제창"에서 승인/실패를 고른다. 결제 ID에 결과가 담긴다(MOCK-…-OK / MOCK-…-FAIL). 실제 돈은 오가지 않는다.
 * 전환: PAYMENT_DRIVER=portone|mock (기본 mock). Real 은 PORTONE_API_SECRET·PORTONE_STORE_ID·PORTONE_CHANNEL_KEY 필요.
 */

export interface PaymentVerifyResult {
  /** 결제 완료이고 금액이 기대 금액과 같으면 true */
  ok: boolean;
  /** pg_tid (PG 거래 ID) */
  pgTid: string | null;
  amount: number;
  /** PAYMENT_METHOD 코드 */
  method: string | null;
  approvedAt: Date | null;
  receiptUrl: string | null;
  failReason: string | null;
}

export interface PaymentCancelResult {
  ok: boolean;
  cancelTid: string | null;
  failReason: string | null;
}

export interface PaymentGateway {
  kind: 'mock' | 'portone';
  /** payment.pg_provider 코드 (PG_PROVIDER) */
  provider: 'MOCK' | 'TOSS';
  /** 결제창 결과를 PG 서버에서 다시 확인한다 (금액 위변조 방지: 기대 금액과 비교) */
  verify(paymentId: string, expectedAmount: number): Promise<PaymentVerifyResult>;
  /** 결제 취소(부분 취소 포함) */
  cancel(paymentId: string, amount: number, reason: string): Promise<PaymentCancelResult>;
}

export type PaymentDriver = 'mock' | 'portone';
export const resolvePaymentDriver = (v: string | undefined): PaymentDriver => (v === 'portone' ? 'portone' : 'mock');

/* ---------- Mock ---------- */

export const MOCK_PAYMENT_PREFIX = 'MOCK-';
/** 모의 결제창 결과를 결제 ID에 담는다 */
export const mockPaymentId = (paymentNo: string, outcome: 'OK' | 'FAIL') => `${MOCK_PAYMENT_PREFIX}${paymentNo}-${outcome}`;

export function createMockPaymentGateway(): PaymentGateway {
  return {
    kind: 'mock',
    provider: 'MOCK',
    async verify(paymentId, expectedAmount) {
      const ok = paymentId.startsWith(MOCK_PAYMENT_PREFIX) && paymentId.endsWith('-OK');
      return {
        ok,
        pgTid: ok ? paymentId : null,
        amount: ok ? expectedAmount : 0,
        method: null,
        approvedAt: ok ? new Date() : null,
        receiptUrl: null,
        failReason: ok ? null : '모의 결제 실패(테스트)',
      };
    },
    async cancel(paymentId) {
      return { ok: true, cancelTid: `${paymentId}-CANCEL-${Date.now()}`, failReason: null };
    },
  };
}

/* ---------- Real: 포트원 V2 ---------- */

const PORTONE_API = 'https://api.portone.io';

interface PortOnePayment {
  status?: string;
  transactionId?: string;
  amount?: { total?: number };
  method?: { type?: string };
  paidAt?: string;
  receiptUrl?: string;
  failure?: { reason?: string };
  message?: string;
}

/** 포트원 결제수단 → PAYMENT_METHOD */
export function fromPortOneMethod(type: string | undefined): string | null {
  if (!type) return null;
  if (type === 'PaymentMethodCard') return 'CARD';
  if (type === 'PaymentMethodEasyPay') return 'EASY_PAY';
  if (type === 'PaymentMethodTransfer') return 'BANK_TRANSFER';
  if (type === 'PaymentMethodVirtualAccount') return 'VIRTUAL_ACCOUNT';
  return null;
}

export function createPortOnePaymentGateway(opts: { apiSecret: string; fetchImpl?: typeof fetch }): PaymentGateway {
  const f = opts.fetchImpl ?? fetch;
  if (!opts.apiSecret) throw new Error('PORTONE_API_SECRET이 설정되지 않았습니다.');
  const headers = { Authorization: `PortOne ${opts.apiSecret}`, 'Content-Type': 'application/json' };
  return {
    kind: 'portone',
    provider: 'TOSS',
    async verify(paymentId, expectedAmount) {
      const res = await f(`${PORTONE_API}/payments/${encodeURIComponent(paymentId)}`, { headers });
      const body = (await res.json().catch(() => ({}))) as PortOnePayment;
      const paid = res.ok && body.status === 'PAID';
      const amount = body.amount?.total ?? 0;
      const ok = paid && amount === expectedAmount;
      return {
        ok,
        pgTid: body.transactionId ?? null,
        amount,
        method: fromPortOneMethod(body.method?.type),
        approvedAt: body.paidAt ? new Date(body.paidAt) : null,
        receiptUrl: body.receiptUrl ?? null,
        failReason: ok
          ? null
          : paid
            ? `결제 금액이 다릅니다(결제 ${amount}원, 주문 ${expectedAmount}원).`
            : (body.failure?.reason ?? body.message ?? `결제가 완료되지 않았습니다(${body.status ?? res.status}).`),
      };
    },
    async cancel(paymentId, amount, reason) {
      const res = await f(`${PORTONE_API}/payments/${encodeURIComponent(paymentId)}/cancel`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amount, reason }),
      });
      const body = (await res.json().catch(() => ({}))) as { cancellation?: { id?: string; pgCancellationId?: string }; message?: string };
      return res.ok
        ? { ok: true, cancelTid: body.cancellation?.pgCancellationId ?? body.cancellation?.id ?? null, failReason: null }
        : { ok: false, cancelTid: null, failReason: body.message ?? `결제 취소 실패(${res.status})` };
    },
  };
}

export function createPaymentGateway(env: NodeJS.ProcessEnv = process.env): PaymentGateway {
  return resolvePaymentDriver(env.PAYMENT_DRIVER) === 'portone'
    ? createPortOnePaymentGateway({ apiSecret: env.PORTONE_API_SECRET ?? '' })
    : createMockPaymentGateway();
}

/** 포트원 브라우저 SDK (결제창·본인인증 창). 화면 쪽에서 스크립트로 불러온다. */
export const PORTONE_BROWSER_SDK = 'https://cdn.portone.io/v2/browser-sdk.js';
