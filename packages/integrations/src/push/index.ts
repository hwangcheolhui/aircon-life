/**
 * 앱 푸시 (단계 4-1 "배정 즉시 기사 앱에 푸시", 02 §6). CLAUDE.md §7 인터페이스 + Mock.
 * - 기사 앱은 지금 웹앱(/tech)이라 알림은 notification_log(channel=PUSH)에 남겨 기사 알림함(T-NTF-010)에 보여 주고,
 *   이 어댑터는 휴대폰 잠금 화면 알림을 보낼 자리다.
 * - Mock(기본): 실제로 보내지 않고 메모리에 남기며 서버 로그에는 받는 사람 종류·ID만 찍는다.
 * - Real(FCM 등)은 기사 앱 설치 형태(PWA·네이티브)가 정해지면 기기 토큰 저장과 함께 붙인다(06 §4). 전환: PUSH_DRIVER.
 */

export interface PushMessage {
  receiverType: 'TECHNICIAN' | 'ADMIN' | 'CUSTOMER';
  receiverId: number;
  title: string;
  body: string;
  /** 누르면 열 화면 경로 (예: /tech/jobs/2611230001) */
  link?: string;
}

export interface PushResult {
  ok: boolean;
  failReason?: string;
}

export interface PushSender {
  kind: PushDriver;
  send(m: PushMessage): Promise<PushResult>;
}

export type PushDriver = 'mock';

export const resolvePushDriver = (_v: string | undefined): PushDriver => 'mock';

export interface MockPushSender extends PushSender {
  readonly sent: PushMessage[];
}

export function createMockPushSender(opts: { fail?: boolean; silent?: boolean } = {}): MockPushSender {
  const sent: PushMessage[] = [];
  return {
    kind: 'mock',
    sent,
    async send(m) {
      if (opts.fail) return { ok: false, failReason: 'Mock 푸시 실패' };
      sent.push(m);
      if (!opts.silent) console.info(`[push:mock] ${m.receiverType}#${m.receiverId} ${m.title}`);
      return { ok: true };
    },
  };
}

export function createPushSender(env: NodeJS.ProcessEnv = process.env): PushSender {
  resolvePushDriver(env.PUSH_DRIVER);
  return createMockPushSender({ fail: env.MOCK_PUSH_FAIL === 'true' });
}
