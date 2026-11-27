import { describe, expect, it } from 'vitest';
import { createDeviceRecognizer } from './index';
import { createSafeNumberProvider } from '../safe-number';

describe('사진 인식 Mock (F-CUS-QUO-03)', () => {
  const r = createDeviceRecognizer({});
  it('같은 사진은 같은 결과, 이름 힌트가 있으면 그 유형으로 높은 신뢰도', async () => {
    const a = await r.recognize({ fileName: 'x.jpg', size: 1000, contentType: 'image/jpeg' });
    expect(await r.recognize({ fileName: 'x.jpg', size: 1000, contentType: 'image/jpeg' })).toEqual(a);
    expect(a.confidence).toBeGreaterThanOrEqual(0.5);
    expect(a.confidence).toBeLessThan(1);
    const s = await r.recognize({ fileName: 'my-stand.png', size: 5, contentType: 'image/png' });
    expect(s.deviceType).toBe('STAND');
    expect(s.confidence).toBeGreaterThan(0.9);
  });
  it('이미지가 아니면 인식하지 않는다', async () => {
    expect((await r.recognize({ fileName: 'a.pdf', size: 1, contentType: 'application/pdf' })).deviceType).toBeNull();
  });
});

describe('안심번호 Mock', () => {
  it('주문·발신자별로 같은 번호, 24시간 유효', async () => {
    const p = createSafeNumberProvider({});
    const now = new Date('2026-11-26T00:00:00Z');
    const a = await p.issue({ orderNo: 'A2611260001', caller: 'CUSTOMER' }, now);
    expect(a.number).toMatch(/^0504-\d{4}-\d{4}$/);
    expect((await p.issue({ orderNo: 'A2611260001', caller: 'CUSTOMER' }, now)).number).toBe(a.number);
    expect(a.expiresAt!.getTime() - now.getTime()).toBe(86_400_000);
    expect((await p.issue({ orderNo: '', caller: 'CUSTOMER' })).ok).toBe(false);
  });
});
