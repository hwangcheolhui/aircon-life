'use server';
// C-QUO-010~040 고객 견적 서버 액션 (비회원 가능, F-CUS-AUTH-02). 공용 견적 모듈만 거친다(F-CUS-QUO-04).
import { customerQuoteInput, legalDongCodeInput } from '@aircon/contracts';
import { quoteFailureMessage } from '@aircon/domain';
import { handle, parse } from '@/server/action-result';
import { isDbConfigured } from '@/server/db';
import { computeQuote, findServiceArea, issueQuote } from '@/server/quote';

/** F-CUS-QUO-01 위치 입력·서비스 지역 확인 (BR-001) */
export async function checkServiceArea(legalDongCode: string) {
  return handle(async () => {
    const code = parse(legalDongCodeInput, legalDongCode);
    if (!isDbConfigured()) return { serviceable: false };
    const r = await findServiceArea(code);
    return { serviceable: r.serviceable };
  });
}

/** F-CUS-QUO-04 C-QUO-030 하단 바 예상 금액 (저장하지 않음) */
export async function previewQuote(input: unknown) {
  return handle(async () => {
    const q = parse(customerQuoteInput, input);
    const r = await computeQuote({ ...q, customerType: 'PERSONAL', visit: null });
    return r.ok
      ? { ok: true as const, totalAmount: r.totalAmount }
      : { ok: false as const, message: quoteFailureMessage(r) };
  });
}

/** F-CUS-QUO-04 자동 표준 견적 산출 → 견적 발행(quote ISSUED) 후 결과 화면 번호를 돌려준다 */
export async function submitQuote(input: unknown) {
  return handle(async () => {
    const q = parse(customerQuoteInput, input);
    const r = await issueQuote({ ...q, customerType: 'PERSONAL', visit: null }, 'APP');
    return r.ok
      ? { ok: true as const, quoteNo: r.quoteNo }
      : { ok: false as const, message: quoteFailureMessage(r) };
  });
}
