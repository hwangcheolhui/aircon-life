/**
 * 알림톡·문자 발송 (F-SYS-03, 접수 알림 등). CLAUDE.md §7 인터페이스 + Mock + Real. 알림톡 실패 시 문자(SMS)로 대체한다.
 * - Real: 솔라피 (06 §4.3). SOLAPI_API_KEY·SOLAPI_API_SECRET·SOLAPI_SENDER_NUMBER, 알림톡은 SOLAPI_KAKAO_PF_ID + 템플릿의 kakao_template_id.
 * - Mock: 실제로 보내지 않고 성공으로 기록한다. MOCK_NOTIFY_ALIMTALK_FAIL=true 면 알림톡이 실패한 것으로 보고 문자 대체 흐름을 시험한다.
 * 전환: NOTIFY_DRIVER=solapi|mock (기본 mock)
 */
import { createHmac, randomBytes } from 'node:crypto';

export interface NotifyMessage {
  to: string;
  text: string;
  title?: string;
  /** 알림톡 템플릿 ID (없으면 바로 문자로 보낸다) */
  kakaoTemplateId?: string | null;
  /** 알림톡 치환 변수 { '#{고객명}': '홍*동' } */
  variables?: Record<string, string>;
}

/** 실제 전송 수단 (알림톡·문자 각각 1회 시도) */
export interface NotifyTransport {
  kind: 'mock' | 'solapi';
  sendAlimtalk(m: NotifyMessage): Promise<{ ok: boolean; error?: string }>;
  sendSms(m: NotifyMessage): Promise<{ ok: boolean; error?: string }>;
}

/** notification_log 에 남길 결과 */
export interface NotifyOutcome {
  /** NOTIFICATION_STATUS: SENT / FAILED / FALLBACK_SMS */
  status: 'SENT' | 'FAILED' | 'FALLBACK_SMS';
  /** 실제로 나간 채널 */
  channel: 'ALIMTALK' | 'SMS';
  failReason: string | null;
}

/** 알림톡 → 실패 시 문자 대체 (02 §6 "알림톡 실패 시 SMS 대체") */
export async function sendWithFallback(t: NotifyTransport, m: NotifyMessage, preferred: 'ALIMTALK' | 'SMS'): Promise<NotifyOutcome> {
  let alimtalkError: string | null = null;
  if (preferred === 'ALIMTALK' && m.kakaoTemplateId) {
    const r = await t.sendAlimtalk(m).catch((e: Error) => ({ ok: false, error: e.message }));
    if (r.ok) return { status: 'SENT', channel: 'ALIMTALK', failReason: null };
    alimtalkError = r.error ?? '알림톡 발송 실패';
  } else if (preferred === 'ALIMTALK') {
    alimtalkError = '알림톡 템플릿 ID 없음';
  }
  const s = await t.sendSms(m).catch((e: Error) => ({ ok: false, error: e.message }));
  if (!s.ok) return { status: 'FAILED', channel: 'SMS', failReason: [alimtalkError, s.error ?? '문자 발송 실패'].filter(Boolean).join(' / ') };
  return alimtalkError
    ? { status: 'FALLBACK_SMS', channel: 'SMS', failReason: alimtalkError }
    : { status: 'SENT', channel: 'SMS', failReason: null };
}

export function createMockNotifyTransport(opts: { failAlimtalk?: boolean } = {}): NotifyTransport {
  return {
    kind: 'mock',
    async sendAlimtalk() {
      return opts.failAlimtalk ? { ok: false, error: '모의 알림톡 실패(테스트)' } : { ok: true };
    },
    async sendSms() {
      return { ok: true };
    },
  };
}

/** 솔라피 API 인증 헤더 (HMAC-SHA256) */
export function solapiAuthHeader(apiKey: string, apiSecret: string, date = new Date().toISOString(), salt = randomBytes(16).toString('hex')) {
  const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export function createSolapiTransport(o: {
  apiKey: string;
  apiSecret: string;
  sender: string;
  pfId?: string;
  fetchImpl?: typeof fetch;
}): NotifyTransport {
  const f = o.fetchImpl ?? fetch;
  if (!o.apiKey || !o.apiSecret || !o.sender) throw new Error('SOLAPI_API_KEY·SOLAPI_API_SECRET·SOLAPI_SENDER_NUMBER가 필요합니다.');
  const post = async (message: Record<string, unknown>) => {
    const res = await f('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: { Authorization: solapiAuthHeader(o.apiKey, o.apiSecret), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { from: o.sender, ...message } }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { errorMessage?: string };
    return { ok: false, error: body.errorMessage ?? `솔라피 오류(${res.status})` };
  };
  return {
    kind: 'solapi',
    async sendAlimtalk(m) {
      if (!o.pfId || !m.kakaoTemplateId) return { ok: false, error: '알림톡 채널(pfId)·템플릿 ID 없음' };
      return post({
        to: m.to,
        type: 'ATA',
        text: m.text,
        kakaoOptions: { pfId: o.pfId, templateId: m.kakaoTemplateId, variables: m.variables ?? {}, disableSms: true },
      });
    },
    async sendSms(m) {
      const long = new TextEncoder().encode(m.text).length > 90;
      return post({ to: m.to, type: long ? 'LMS' : 'SMS', text: m.text, ...(long && m.title ? { subject: m.title } : {}) });
    },
  };
}

export function createNotifyTransport(env: NodeJS.ProcessEnv = process.env): NotifyTransport {
  if (env.NOTIFY_DRIVER === 'solapi') {
    return createSolapiTransport({
      apiKey: env.SOLAPI_API_KEY ?? '',
      apiSecret: env.SOLAPI_API_SECRET ?? '',
      sender: env.SOLAPI_SENDER_NUMBER ?? '',
      pfId: env.SOLAPI_KAKAO_PF_ID || undefined,
    });
  }
  return createMockNotifyTransport({ failAlimtalk: env.MOCK_NOTIFY_ALIMTALK_FAIL === 'true' });
}
