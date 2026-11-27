import { describe, expect, it } from 'vitest';
import { checkDocFiles, joinFileIds, nextDocVersion, parseFileIds, sortTechDocs } from './tech-doc';

describe('기술자료 버전·첨부 (F-ADM-CNT-03)', () => {
  const prev = { version: 2, title: 'SOP', content: '분해 순서', fileIds: [3] };
  it('처음 1, 제목·내용·첨부가 바뀌면 +1, 같으면 그대로', () => {
    expect(nextDocVersion(null, prev)).toBe(1);
    expect(nextDocVersion(prev, { title: 'SOP', content: '분해 순서', fileIds: [3] })).toBe(2);
    expect(nextDocVersion(prev, { title: 'SOP', content: '분해 순서 v2', fileIds: [3] })).toBe(3);
    expect(nextDocVersion(prev, { title: 'SOP', content: '분해 순서', fileIds: [] })).toBe(3);
  });
  it('첨부 개수·크기·형식', () => {
    expect(checkDocFiles([{ size: 100, type: 'application/pdf' }], 2)).toBeNull();
    expect(checkDocFiles([{ size: 100, type: 'application/pdf' }], 3)).toContain('3개');
    expect(checkDocFiles([{ size: 5 * 1024 * 1024, type: 'image/png' }], 0)).toContain('3.5MB');
    expect(checkDocFiles([{ size: 2 * 1024 * 1024, type: 'image/png' }, { size: 2 * 1024 * 1024, type: 'application/pdf' }], 0)).toContain('3.5MB');
    expect(checkDocFiles([{ size: 1024 * 1024, type: 'image/png' }, { size: 2 * 1024 * 1024, type: 'application/pdf' }], 0)).toBeNull();
    expect(checkDocFiles([{ size: 10, type: 'application/zip' }], 0)).toContain('PDF');
  });
  it('file_ids 문자열 변환', () => {
    expect(parseFileIds('3, 5,x,0')).toEqual([3, 5]);
    expect(joinFileIds([])).toBeNull();
    expect(joinFileIds([1, 2])).toBe('1,2');
  });
  it('필독 먼저, 최근 수정 순', () => {
    const docs = [
      { id: 1, isRequiredRead: false, updatedAt: new Date('2026-11-20') },
      { id: 2, isRequiredRead: true, updatedAt: new Date('2026-11-01') },
      { id: 3, isRequiredRead: false, updatedAt: new Date('2026-11-25') },
    ];
    expect(sortTechDocs(docs).map((d) => d.id)).toEqual([2, 3, 1]);
  });
});
