// A-CNT-020 FAQ · F-ADM-CNT-02: 고객/기사 FAQ, 분류·순서·게시, 상담에서 만든 초안(출처 상담 표시). 고객 C-CS-010에 게시된 것만 노출
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { listFaqs } from '@/server/content';
import { screenFlags } from '@/server/crud';
import { FaqsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function FaqsPage() {
  const admin = await requireScreen('A-CNT-020');
  const [rows, codes] = await Promise.all([listFaqs(null), loadCodes(['FAQ_AUDIENCE', 'FAQ_CATEGORY'])]);
  const flags = screenFlags(admin, 'A-CNT-020');
  const live = !admin.preview;
  return <FaqsScreen rows={rows} codes={codes} canCreate={live && flags.canCreate} canUpdate={live && flags.canUpdate} canDelete={live && flags.canDelete} />;
}
