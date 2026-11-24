import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createLocalStorage } from './index';

const dir = mkdtempSync(join(tmpdir(), 'ac-storage-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('첨부파일 저장소 Mock(로컬 디스크)', () => {
  const s = createLocalStorage(dir);

  it('올린 파일을 그대로 읽는다 (F-TEC-WRK-03 작업 사진)', async () => {
    await s.put('work_photo/2026-12-01/a.jpg', new Uint8Array([1, 2, 3]), 'image/jpeg');
    expect(Array.from((await s.get('work_photo/2026-12-01/a.jpg'))!)).toEqual([1, 2, 3]);
  });

  it('없는 파일은 null', async () => {
    expect(await s.get('work_photo/none.jpg')).toBeNull();
  });

  it('예외: 저장 폴더 밖 경로는 거부한다', async () => {
    await expect(s.get('../outside.txt')).rejects.toThrow();
    await expect(s.put('../../x', new Uint8Array([1]), 'text/plain')).rejects.toThrow();
  });
});
