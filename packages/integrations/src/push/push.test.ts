import { describe, expect, it } from 'vitest';
import { createMockPushSender, createPushSender } from './index';

describe('앱 푸시 (Mock)', () => {
  it('보낸 메시지를 남긴다', async () => {
    const p = createMockPushSender({ silent: true });
    expect(await p.send({ receiverType: 'TECHNICIAN', receiverId: 3, title: '새 작업 배정', body: '내용' })).toEqual({ ok: true });
    expect(p.sent).toHaveLength(1);
  });
  it('실패를 흉내 낼 수 있다(MOCK_PUSH_FAIL)', async () => {
    const p = createPushSender({ MOCK_PUSH_FAIL: 'true' } as NodeJS.ProcessEnv);
    expect((await p.send({ receiverType: 'TECHNICIAN', receiverId: 3, title: 't', body: 'b' })).ok).toBe(false);
  });
});
