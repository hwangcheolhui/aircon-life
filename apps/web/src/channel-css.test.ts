// 채널별 스타일 파일 규칙 점검 (05 §8.6, CLAUDE.md §8): 접두사 · 토큰만 사용
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CHANNELS = [
  { channel: 'customer', file: 'customer/customer.css', prefix: 'cus-' },
  { channel: 'tech', file: 'tech/tech.css', prefix: 'tec-' },
  { channel: 'admin', file: 'admin/admin.css', prefix: 'adm-' },
] as const;

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe.each(CHANNELS)('$channel 채널 스타일 ($file)', ({ file, prefix }) => {
  const css = stripComments(readFileSync(join(__dirname, file), 'utf8'));

  it(`새로 정의하는 클래스는 ${prefix} 로 시작한다 (ac- 는 공용 컴포넌트를 꾸밀 때만)`, () => {
    const classes = [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!);
    const bad = classes.filter((c) => !c.startsWith(prefix) && !c.startsWith('ac-') && !c.startsWith('is-'));
    expect(bad).toEqual([]);
  });

  it('색 코드(#…)·rgb()를 직접 쓰지 않는다', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  it('원시 색상 토큰(--gray-*, --blue-* 등)을 직접 참조하지 않는다', () => {
    expect(css).not.toMatch(/var\(--(gray|blue|red|green|orange|yellow|amber|indigo|lime|teal|violet)-\d+/);
  });

  it('반경·그림자는 토큰으로만 지정한다', () => {
    for (const m of css.matchAll(/(border-radius|box-shadow)\s*:\s*([^;]+);/g)) {
      expect(m[2]!.trim()).toMatch(/^var\(--/);
    }
  });
});
