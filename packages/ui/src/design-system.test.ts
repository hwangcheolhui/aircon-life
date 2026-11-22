import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 05 §9 단일 출처: packages/ui 복사본이 docs/design-system 과 같아야 한다 (pnpm --filter @aircon/ui sync)
describe('디자인 시스템 동기화', () => {
  for (const f of ['tokens.css', 'components.css', 'tokens.json']) {
    it(`${f}가 docs/design-system과 같다`, () => {
      const docs = readFileSync(join(__dirname, '../../../docs/design-system', f), 'utf8');
      const copy = readFileSync(join(__dirname, 'styles', f), 'utf8');
      expect(copy).toBe(docs);
    });
  }
});
