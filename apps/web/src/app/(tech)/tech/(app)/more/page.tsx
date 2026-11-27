// T-MORE-010 더보기: 업무·자재·교육·소식 메뉴 + ★ 퀵메뉴 추가·해제(F-TEC-HOM-04, 단계 10) + 로그아웃
import { TECH_QUICK_MENUS } from '@aircon/domain';
import { Bell, BookOpen, CalendarDays, CalendarRange, GraduationCap, LogOut, Megaphone, Package, PackagePlus, Route, Star, UserRound } from 'lucide-react';
import Link from 'next/link';
import { getQuickMenu } from '@/server/tech-support';
import { requireTech } from '@/server/tech-session';
import { QuickStar } from '@/tech/quick-star';
import { TechTopbar } from '@/tech/topbar';
import { logoutTech } from '../actions';

export const metadata = { title: '더보기' };
export const dynamic = 'force-dynamic';

const ITEMS = [
  { code: 'T-CAL-010', icon: CalendarDays },
  { code: 'T-RTE-030', icon: CalendarRange },
  { code: 'T-RTE-010', icon: Route },
  { code: 'T-MAT-010', icon: Package },
  { code: 'T-MAT-020', icon: PackagePlus },
  { code: 'T-EDU-010', icon: BookOpen },
  { code: 'T-EDU-020', icon: GraduationCap },
  { code: 'T-NTC-010', icon: Megaphone },
  { code: 'T-NTF-010', icon: Bell },
  { code: 'T-MY-010', icon: UserRound },
] as const;

export default async function TechMorePage() {
  const me = await requireTech();
  const quick = await getQuickMenu(me.id);
  return (
    <main className="tec-page__body">
      <TechTopbar title="더보기" />
      <nav className="tec-menu-grid" aria-label="더보기 메뉴">
        {ITEMS.map((it) => {
          const m = TECH_QUICK_MENUS.find((x) => x.code === it.code)!;
          return (
            <div key={it.code} className="tec-menu-cell">
              <Link href={m.href}>
                <it.icon aria-hidden />
                {m.name}
              </Link>
              <QuickStar code={m.code} name={m.name} on={(quick as string[]).includes(m.code)} />
            </div>
          );
        })}
        <Link href="/tech/my/quick-menu">
          <Star aria-hidden />
          퀵메뉴 설정
        </Link>
        <form action={logoutTech}>
          <button type="submit" className="tec-menu-btn">
            <LogOut aria-hidden />
            로그아웃
          </button>
        </form>
      </nav>
    </main>
  );
}
