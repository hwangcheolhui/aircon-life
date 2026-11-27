// T-MY-020 퀵메뉴 설정 · F-TEC-HOM-04: ★ 로 추가·해제, 위·아래로 순서 변경(저장하면 홈 슬라이드 순서)
import { TECH_QUICK_MENUS } from '@aircon/domain';
import { getQuickMenu } from '@/server/tech-support';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';
import { QuickMenuEditor } from './quick-menu-editor';

export const metadata = { title: '퀵메뉴 설정' };
export const dynamic = 'force-dynamic';

export default async function TechQuickMenuPage() {
  const me = await requireTech();
  const codes = await getQuickMenu(me.id);
  return (
    <main className="tec-page__body">
      <TechTopbar title="퀵메뉴 설정" back={{ href: '/tech/my', label: '내 정보로' }} />
      <QuickMenuEditor initial={codes} menus={TECH_QUICK_MENUS.map((m) => ({ code: m.code, name: m.name }))} />
    </main>
  );
}
