'use client';
/**
 * 포트원 V2 브라우저 SDK (PAYMENT_DRIVER·IDENTITY_DRIVER=portone 일 때만). 결제·본인인증 창을 띄우고, 결과 확인은 반드시 서버가 한다.
 * 상점 ID·채널 키는 공개 식별자라 서버가 화면에 넘겨 준다(비밀키 PORTONE_API_SECRET 은 서버에만).
 */
import { PORTONE_BROWSER_SDK } from '@aircon/integrations/payment';

export interface PortOneConfig {
  storeId: string;
  channelKey: string;
}

type PortOneResponse = { code?: string; message?: string; paymentId?: string; identityVerificationId?: string } | undefined;
declare global {
  interface Window {
    PortOne?: {
      requestPayment(o: Record<string, unknown>): Promise<PortOneResponse>;
      requestIdentityVerification(o: Record<string, unknown>): Promise<PortOneResponse>;
    };
  }
}

let loading: Promise<void> | null = null;
function load(): Promise<void> {
  if (window.PortOne) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PORTONE_BROWSER_SDK;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('결제·인증 창을 불러오지 못했습니다.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** 본인인증 창 → 성공하면 인증 ID, 취소·실패면 오류 메시지 */
export async function portoneIdentity(cfg: PortOneConfig, id: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  await load();
  const r = await window.PortOne!.requestIdentityVerification({ storeId: cfg.storeId, channelKey: cfg.channelKey, identityVerificationId: id });
  return r?.code ? { ok: false, message: r.message ?? '본인인증이 완료되지 않았습니다.' } : { ok: true, id };
}

/** 결제창 → 성공하면 결제 ID. 모바일은 redirectUrl 로 돌아온다 */
export async function portonePayment(
  cfg: PortOneConfig,
  o: { paymentId: string; orderName: string; amount: number; redirectUrl: string },
): Promise<{ ok: true; paymentId: string } | { ok: false; message: string }> {
  await load();
  const r = await window.PortOne!.requestPayment({
    storeId: cfg.storeId,
    channelKey: cfg.channelKey,
    paymentId: o.paymentId,
    orderName: o.orderName,
    totalAmount: o.amount,
    currency: 'CURRENCY_KRW',
    payMethod: 'CARD',
    redirectUrl: o.redirectUrl,
  });
  return r?.code ? { ok: false, message: r.message ?? '결제가 완료되지 않았습니다.' } : { ok: true, paymentId: o.paymentId };
}
