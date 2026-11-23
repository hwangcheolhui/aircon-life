/**
 * 알림 발송 (알림톡 + SMS 대체). CLAUDE.md §7 인터페이스 + Mock + Real, 06 §4.3 솔라피.
 * 사용처: F-ADM-DSP-11·F-SYS-19 지역 오픈 안내(단계 1 보강), 이후 단계 2 예약 알림(F-SYS-03 등).
 * 전환: NOTIFY_DRIVER=mock|solapi (기본 mock). 서버 전용. Mock에서 MOCK_NOTIFY_ALIMTALK_FAIL=true 면 알림톡 실패를 흉내 낸다.
 * - Mock: 실제로 보내지 않고 보낸 내용을 메모리에 남기며, 서버 로그에는 마스킹 번호만 찍는다.
 * - Real(솔라피 REST v4): SOLAPI_API_KEY·SOLAPI_API_SECRET·SOLAPI_SENDER_NUMBER, 알림톡은 SOLAPI_KAKAO_PF_ID + 메시지의 kakaoTemplateId.
 *   알림톡 템플릿이 아직 없으면(kakaoTemplateId 없음) 바로 SMS로 보낸다.
 */
import { createHmac, randomBytes } from 'node:crypto';

export type NotifyChannel = 'ALIMTALK' | 'SMS';

export interface NotifyMessage {
  /** 받는 번호(숫자·하이픈 허용) */
  to: string;
  /** 본문(치환이 끝난 문구). SMS 대체 시 그대로 문자로 보낸다 */
  text: string;
  title?: string;
  /** 카카오 알림톡 검수 템플릿 ID */
  kakaoTemplateId?: string;
  /** 알림톡 치환 변수 (#{변수} → 값) */
  variables?: Record<string, string>;
}

export interface TransportResult {
  ok: boolean;
  failReason?: string;
}

export interface NotifyTransport {
  sendAlimtalk(m: NotifyMessage): Promise<TransportResult>;
  sendSms(m: NotifyMessage): Promise<TransportResult>;
}

export interface NotifyResult {
  /** notification_log.status 와 같은 값 (01 §2.12.2) */
  status: 'SENT' | 'FALLBACK_SMS' | 'FAILED';
  channel: NotifyChannel | null;
  failReason?: string;
}

const digits = (s: string) => s.replace(/[^0-9]/g, '');
const masked = (s: string) => {
  const d = digits(s);
  return d.length < 7 ? '*'.repeat(d.length) : `${d.slice(0, 3)}-****-${d.slice(-4)}`;
};

/** 알림톡 우선, 실패 시 SMS로 대체 (02 §6 "알림톡 실패 시 SMS 대체") */
export async function sendWithFallback(
  t: NotifyTransport,
  msg: NotifyMessage,
  preferred: NotifyChannel = 'ALIMTALK',
): Promise<NotifyResult> {
  const safe = async (fn: () => Promise<TransportResult>): Promise<TransportResult> => {
    try {
      return await fn();
    } catch (e) {
      return { ok: false, failReason: e instanceof Error ? e.message : String(e) };
    }
  };
  if (preferred === 'ALIMTALK') {
    const a = await safe(() => t.sendAlimtalk(msg));
    if (a.ok) return { status: 'SENT', channel: 'ALIMTALK' };
    const s = await safe(() => t.sendSms(msg));
    if (s.ok) return { status: 'FALLBACK_SMS', channel: 'SMS', failReason: a.failReason };
    return {
      status: 'FAILED',
      channel: null,
      failReason: [a.failReason, s.failReason].filter(Boolean).join(' / ') || '발송 실패',
    };
  }
  const s = await safe(() => t.sendSms(msg));
  return s.ok
    ? { status: 'SENT', channel: 'SMS' }
    : { status: 'FAILED', channel: null, failReason: s.failReason ?? '발송 실패' };
}

/* ---------- Mock ---------- */

export interface MockSent {
  channel: NotifyChannel;
  message: NotifyMessage;
}

export interface MockNotifyTransport extends NotifyTransport {
  readonly sent: MockSent[];
}

/** 개발·테스트용. fail 옵션으로 채널별 실패를 흉내 낸다 */
export function createMockNotifyTransport(
  opts: { failAlimtalk?: boolean; failSms?: boolean; silent?: boolean } = {},
): MockNotifyTransport {
  const sent: MockSent[] = [];
  const send = async (channel: NotifyChannel, m: NotifyMessage, fail?: boolean): Promise<TransportResult> => {
    if (fail) return { ok: false, failReason: `Mock ${channel} 실패` };
    sent.push({ channel, message: m });
    if (!opts.silent) console.info(`[notify:mock] ${channel} → ${masked(m.to)} ${m.title ?? ''}`.trim());
    return { ok: true };
  };
  return {
    sent,
    sendAlimtalk: (m) => send('ALIMTALK', m, opts.failAlimtalk),
    sendSms: (m) => send('SMS', m, opts.failSms),
  };
}

/* ---------- Real: 솔라피 REST v4 ---------- */

export interface SolapiConfig {
  apiKey: string;
  apiSecret: string;
  sender: string;
  pfId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** 솔라피 HMAC-SHA256 인증 헤더: signature = HMAC(date + salt, apiSecret) */
export function solapiAuthHeader(
  apiKey: string,
  apiSecret: string,
  date = new Date().toISOString(),
  salt = randomBytes(16).toString('hex'),
) {
  const signature = createHmac('sha256', apiSecret)
    .update(date + salt)
    .digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export function createSolapiTransport(cfg: SolapiConfig): NotifyTransport {
  const f = cfg.fetchImpl ?? fetch;
  const url = `${cfg.baseUrl ?? 'https://api.solapi.com'}/messages/v4/send`;
  const post = async (message: Record<string, unknown>): Promise<TransportResult> => {
    if (!cfg.apiKey || !cfg.apiSecret || !cfg.sender)
      return { ok: false, failReason: '솔라피 설정(SOLAPI_*)이 비어 있습니다.' };
    const res = await f(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: solapiAuthHeader(cfg.apiKey, cfg.apiSecret),
      },
      body: JSON.stringify({ message: { from: digits(cfg.sender), ...message } }),
    });
    if (res.ok) return { ok: true };
    const body = await res.text().catch(() => '');
    return { ok: false, failReason: `솔라피 ${res.status} ${body.slice(0, 150)}`.trim() };
  };
  return {
    async sendAlimtalk(m) {
      if (!cfg.pfId || !m.kakaoTemplateId) return { ok: false, failReason: '알림톡 템플릿 미등록' };
      return post({
        to: digits(m.to),
        text: m.text,
        // 대체 발송은 sendWithFallback 이 SMS로 직접 하므로 솔라피 자체 대체는 끈다(중복 방지)
        kakaoOptions: {
          pfId: cfg.pfId,
          templateId: m.kakaoTemplateId,
          variables: m.variables ?? {},
          disableSms: true,
        },
      });
    },
    sendSms(m) {
      return post({ to: digits(m.to), text: m.text, ...(m.title ? { subject: m.title } : {}) });
    },
  };
}

export type NotifyDriver = 'mock' | 'solapi';

export function resolveNotifyDriver(value: string | undefined): NotifyDriver {
  return value === 'solapi' ? 'solapi' : 'mock';
}

export function createNotifyTransport(env: NodeJS.ProcessEnv = process.env): NotifyTransport {
  if (resolveNotifyDriver(env.NOTIFY_DRIVER) === 'solapi') {
    return createSolapiTransport({
      apiKey: env.SOLAPI_API_KEY ?? '',
      apiSecret: env.SOLAPI_API_SECRET ?? '',
      sender: env.SOLAPI_SENDER_NUMBER ?? '',
      pfId: env.SOLAPI_KAKAO_PF_ID || undefined,
    });
  }
  // MOCK_NOTIFY_ALIMTALK_FAIL=true 면 알림톡 실패 → SMS 대체 흐름을 시험한다
  return createMockNotifyTransport({ failAlimtalk: env.MOCK_NOTIFY_ALIMTALK_FAIL === 'true' });
}
