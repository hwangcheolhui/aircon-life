import { describe, expect, it, vi } from 'vitest';
import {
  createMockNotifyTransport,
  createNotifyTransport,
  createSolapiTransport,
  resolveNotifyDriver,
  sendWithFallback,
  solapiAuthHeader,
} from './index';

const msg = { to: '010-0000-0000', text: '테스트 안내', kakaoTemplateId: 'T1' };

describe('알림 발송 — 알림톡 실패 시 SMS 대체 (02 §6)', () => {
  it('알림톡이 성공하면 SENT/ALIMTALK', async () => {
    const t = createMockNotifyTransport({ silent: true });
    expect(await sendWithFallback(t, msg)).toEqual({ status: 'SENT', channel: 'ALIMTALK' });
    expect(t.sent).toHaveLength(1);
  });
  it('알림톡이 실패하면 SMS로 대체해 FALLBACK_SMS', async () => {
    const t = createMockNotifyTransport({ failAlimtalk: true, silent: true });
    const r = await sendWithFallback(t, msg);
    expect(r.status).toBe('FALLBACK_SMS');
    expect(r.channel).toBe('SMS');
    expect(t.sent.map((s) => s.channel)).toEqual(['SMS']);
  });
  it('둘 다 실패하면 FAILED + 사유', async () => {
    const t = createMockNotifyTransport({ failAlimtalk: true, failSms: true, silent: true });
    const r = await sendWithFallback(t, msg);
    expect(r.status).toBe('FAILED');
    expect(r.channel).toBeNull();
    expect(r.failReason).toContain('SMS');
  });
  it('전송 중 예외도 실패로 처리한다', async () => {
    const r = await sendWithFallback(
      {
        sendAlimtalk: () => Promise.reject(new Error('net')),
        sendSms: () => Promise.reject(new Error('net2')),
      },
      msg,
    );
    expect(r.status).toBe('FAILED');
  });
});

describe('드라이버 전환 NOTIFY_DRIVER', () => {
  it('기본은 mock', () => {
    expect(resolveNotifyDriver(undefined)).toBe('mock');
    expect(resolveNotifyDriver('solapi')).toBe('solapi');
    expect('sent' in createNotifyTransport({} as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('솔라피 Real', () => {
  it('인증 헤더는 HMAC(date+salt) 서명', () => {
    const h = solapiAuthHeader('k', 's', '2026-01-01T00:00:00.000Z', 'abc');
    expect(h).toMatch(
      /^HMAC-SHA256 apiKey=k, date=2026-01-01T00:00:00.000Z, salt=abc, signature=[0-9a-f]{64}$/,
    );
  });
  it('알림톡 템플릿이 없으면 알림톡은 실패 → SMS로 보낸다', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const t = createSolapiTransport({ apiKey: 'k', apiSecret: 's', sender: '0200000000', fetchImpl });
    const r = await sendWithFallback(t, { to: '010-0000-0000', text: '안내' });
    expect(r.status).toBe('FALLBACK_SMS');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.message).toMatchObject({ to: '01000000000', from: '0200000000', text: '안내' });
  });
  it('설정이 비어 있으면 호출하지 않고 실패', async () => {
    const fetchImpl = vi.fn();
    const t = createSolapiTransport({ apiKey: '', apiSecret: '', sender: '', fetchImpl });
    expect((await t.sendSms(msg)).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Mock 알림톡 실패 흉내 MOCK_NOTIFY_ALIMTALK_FAIL', () => {
  it('true 면 알림톡이 실패해 SMS로 대체된다', async () => {
    const t = createNotifyTransport({ MOCK_NOTIFY_ALIMTALK_FAIL: 'true' } as unknown as NodeJS.ProcessEnv);
    expect((await sendWithFallback(t, msg)).status).toBe('FALLBACK_SMS');
  });
});
