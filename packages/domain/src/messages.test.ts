import { describe, expect, it } from 'vitest';
import { MSG } from './messages';

describe('공통 문구', () => {
  it('필수 누락 문구는 받침에 맞는 조사를 붙인다', () => {
    expect(MSG.required('거점명')).toBe('거점명은 필수 입력값입니다.');
    expect(MSG.required('거점 코드')).toBe('거점 코드는 필수 입력값입니다.');
    expect(MSG.required('ID')).toBe('ID은(는) 필수 입력값입니다.');
  });
});
