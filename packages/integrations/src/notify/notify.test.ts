import { describe, expect, it } from 'vitest';
import { createMockPaymentGateway, createPortOnePaymentGateway, mockPaymentId } from '../payment';
import { createMockSocialProvider, createSocialProvider } from '../social';
import { type NotifyTransport, createMockNotifyTransport, sendWithFallback, solapiAuthHeader } from './index';

const msg = { to: '01000000000', text: '안내', kakaoTemplateId: 'T1' };

describe('알림톡 실패 시 문자 대체 (02 §6, 04 §4 알림)', () => {
  it('알림톡이 성공하면 SENT(알림톡)', async () => {
    expect(await sendWithFallback(createMockNotifyTransport(), msg, 'ALIMTALK')).toEqual({
      status: 'SENT',
      channel: 'ALIMTALK',
      failReason: null,
    });
  });
  it('알림톡이 실패하면 문자로 보내고 FALLBACK_SMS', async () => {
    const r = await sendWithFallback(createMockNotifyTransport({ failAlimtalk: true }), msg, 'ALIMTALK');
    expect(r.status).toBe('FALLBACK_SMS');
    expect(r.channel).toBe('SMS');
  });
  it('알림톡 템플릿 ID가 없으면 바로 문자로 보낸다', async () => {
    const r = await sendWithFallback(createMockNotifyTransport(), { ...msg, kakaoTemplateId: null }, 'ALIMTALK');
    expect(r).toMatchObject({ status: 'FALLBACK_SMS', channel: 'SMS' });
  });
  it('예외: 문자까지 실패하면 FAILED와 사유', async () => {
    const t: NotifyTransport = {
      kind: 'mock',
      sendAlimtalk: async () => ({ ok: false, error: 'A' }),
      sendSms: async () => {
        throw new Error('B');
      },
    };
    expect(await sendWithFallback(t, msg, 'ALIMTALK')).toEqual({ status: 'FAILED', channel: 'SMS', failReason: 'A / B' });
  });
  it('솔라피 인증 헤더는 date+salt 를 비밀키로 서명한다', () => {
    expect(solapiAuthHeader('k', 's', '2027-01-01T00:00:00.000Z', 'abc')).toMatch(
      /^HMAC-SHA256 apiKey=k, date=2027-01-01T00:00:00.000Z, salt=abc, signature=[0-9a-f]{64}$/,
    );
  });
});

describe('PG 결제 (F-CUS-PAY-01)', () => {
  it('모의 결제: 승인 ID는 기대 금액으로 승인, 실패 ID는 실패 사유', async () => {
    const g = createMockPaymentGateway();
    expect(await g.verify(mockPaymentId('P1', 'OK'), 90000)).toMatchObject({ ok: true, amount: 90000 });
    expect(await g.verify(mockPaymentId('P1', 'FAIL'), 90000)).toMatchObject({ ok: false, failReason: expect.any(String) });
  });
  it('포트원: 결제 완료라도 금액이 다르면 실패로 본다 (위변조 방지)', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: 'PAID', transactionId: 'tx', amount: { total: 1000 }, method: { type: 'PaymentMethodCard' } }))) as typeof fetch;
    const g = createPortOnePaymentGateway({ apiSecret: 's', fetchImpl });
    expect(await g.verify('P1', 1000)).toMatchObject({ ok: true, method: 'CARD', pgTid: 'tx' });
    expect(await g.verify('P1', 90000)).toMatchObject({ ok: false, failReason: expect.stringMatching(/금액/) });
  });
});

describe('소셜 로그인 (F-CUS-AUTH-01)', () => {
  it('모의 로그인은 콜백으로 바로 돌아와 고정 계정 키를 준다', async () => {
    const p = createMockSocialProvider('KAKAO');
    expect(p.authorizeUrl('st', 'http://x/cb')).toBe('http://x/cb?code=mock-kakao&state=st');
    expect((await p.exchange('mock-kakao', 'http://x/cb', 'st')).providerKey).toBe('mock-kakao-user');
  });
  it('실연동에서 키가 없거나 애플이면 버튼을 숨긴다(null)', () => {
    expect(createSocialProvider('APPLE', { SOCIAL_DRIVER: 'real' })).toBeNull();
    expect(createSocialProvider('KAKAO', { SOCIAL_DRIVER: 'real' })).toBeNull();
    expect(createSocialProvider('KAKAO', { SOCIAL_DRIVER: 'real', KAKAO_REST_API_KEY: 'k' })?.kind).toBe('real');
  });
});
