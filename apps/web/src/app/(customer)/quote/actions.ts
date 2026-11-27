'use server';
// C-QUO-010~040 고객 견적 서버 액션 (비회원 가능, F-CUS-AUTH-02). 공용 견적 모듈만 거친다(F-CUS-QUO-04).
import { areaOpenRequestInput, customerQuoteInput, legalDongCodeInput, recognitionConfirmInput } from '@aircon/contracts';
import { quoteFailureMessage } from '@aircon/domain';
import { UserError, handle, parse } from '@/server/action-result';
import { requestAreaOpen } from '@/server/area-open';
import { confirmRecognition, linkImagesToQuote, recognizeDevicePhotos } from '@/server/device-images';
import { computeQuote, findServiceArea, getQuoteByNo, issueQuote } from '@/server/quote';
import { getCurrentCustomer } from '@/server/customer-session';
import { DEMO_QUOTE_NO, encodeDemoRequest, isQuoteDemoMode } from '@/server/quote-demo';

/** F-CUS-QUO-01 위치 입력·서비스 지역 확인 (BR-001) */
export async function checkServiceArea(legalDongCode: string) {
  return handle(async () => {
    const code = parse(legalDongCodeInput, legalDongCode);
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

/**
 * F-CUS-QUO-04 자동 표준 견적 산출 → 견적 발행(quote ISSUED) 후 결과 화면 경로를 돌려준다.
 * DB 미연결 체험 모드에서는 저장하지 않고 입력값을 결과 화면 주소에 담는다(server/quote-demo.ts).
 */
export async function submitQuote(input: unknown) {
  return handle(async () => {
    const q = parse(customerQuoteInput, input);
    const req = { ...q, customerType: 'PERSONAL' as const, visit: null };
    if (isQuoteDemoMode()) {
      const r = await computeQuote(req);
      return r.ok
        ? { ok: true as const, path: `/quote/result/${DEMO_QUOTE_NO}?r=${encodeDemoRequest(q)}` }
        : { ok: false as const, message: quoteFailureMessage(r) };
    }
    const r = await issueQuote(req, 'APP');
    if (r.ok && q.imageIds.length) {
      const saved = await getQuoteByNo(r.quoteNo);
      if (saved) await linkImagesToQuote(saved.id, q.imageIds); // 단계 9 C-QUO-021 사진 연결
    }
    return r.ok
      ? { ok: true as const, path: `/quote/result/${r.quoteNo}` }
      : { ok: false as const, message: quoteFailureMessage(r) };
  });
}

/**
 * F-CUS-QUO-08 C-QUO-011 서비스 지역 오픈 알림 신청 (BR-003). 비회원 가능.
 * 체험 모드(DB 미연결)에서는 저장하지 않고 kind=DEMO 를 돌려준다.
 */
export async function requestAreaOpenNotice(input: unknown) {
  return handle(async () => {
    const q = parse(areaOpenRequestInput, input);
    return requestAreaOpen(q);
  });
}

/* ---------- 단계 9 C-QUO-021 사진으로 기기 인식 (F-CUS-QUO-05) ---------- */

/** 사진 업로드 → 인식(어댑터) → device_image 저장. 체험 모드(DB 미연결)에서는 쓸 수 없다 */
export async function recognizePhotos(form: FormData) {
  return handle(async () => {
    if (isQuoteDemoMode()) throw new UserError('체험 모드에서는 사진 인식을 쓸 수 없어요. 기기를 직접 골라 주세요.');
    const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
    const c = await getCurrentCustomer();
    return recognizeDevicePhotos(files, c && !c.demo ? c.id : null);
  });
}

/** 인식 결과 확인·수정 저장 */
export async function confirmPhotos(input: unknown) {
  return handle(async () => {
    const v = parse(recognitionConfirmInput, input);
    await confirmRecognition(v.items);
  });
}
