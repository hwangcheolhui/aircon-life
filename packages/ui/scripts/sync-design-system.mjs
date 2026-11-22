// docs/design-system → packages/ui/src/styles 복사 (단일 출처는 docs). CI 테스트가 차이를 검사한다.
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../../docs/design-system');
const dst = join(here, '../src/styles');
for (const f of ['tokens.css', 'components.css', 'tokens.json']) copyFileSync(join(src, f), join(dst, f));
console.log('design-system synced');
