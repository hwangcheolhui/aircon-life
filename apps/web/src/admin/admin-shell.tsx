'use client';
// 관리자 GNB/LNB 셸 (.ac-gnb / .ac-lnb, 05 §6.4)
import { Button } from '@aircon/ui';
import { KeyRound, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { selectBranchAction } from '@/app/(admin)/admin/(protected)/actions';
import { logoutAction } from '@/app/(admin)/admin/login/actions';

export interface ShellMenuGroup {
  key: string;
  name: string;
  screens: { screenId: string; name: string; section?: string; href: string }[];
}

type BranchSelector = { branches: { id: number; name: string }[]; selected: string } | { fixed: string };

export function AdminShell({
  menu,
  user,
  branchSelector,
  children,
}: {
  menu: ShellMenuGroup[];
  user: { name: string; roleName: string };
  branchSelector: BranchSelector;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const current = menu.find((g) => g.screens.some((s) => pathname.startsWith(s.href))) ?? menu[0];
  const currentScreen = current?.screens.find((s) => pathname.startsWith(s.href));
  let lastSection: string | undefined;
  return (
    <div className="ac-admin-shell">
      <header className="ac-gnb">
        <Link href="/admin" className="ac-gnb__brand">
          관리자
        </Link>
        <nav className="ac-gnb__menu" aria-label="주 메뉴">
          {menu.map((g) => (
            <Link key={g.key} href={g.screens[0]!.href} aria-current={g.key === current?.key ? 'true' : undefined}>
              {g.name}
            </Link>
          ))}
        </nav>
        <div className="ac-gnb__tools">
          {'fixed' in branchSelector ? (
            <span className="ac-tag" title="소속 거점(BR-102)">
              {branchSelector.fixed}
            </span>
          ) : (
            <label className="ac-row">
              <span className="ac-sr-only">거점 선택</span>
              <select
                className="ac-select"
                aria-label="거점 선택"
                defaultValue={branchSelector.selected}
                onChange={(e) => selectBranchAction(e.target.value)}
              >
                <option value="">전체 거점</option>
                {branchSelector.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="ac-body-sm">
            {user.name} · {user.roleName}
          </span>
          <Link href="/admin/password" className="ac-btn ac-btn--ghost ac-btn--sm ac-btn--icon" aria-label="비밀번호 변경">
            <KeyRound aria-hidden size={16} />
          </Link>
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" size="sm" icon aria-label="로그아웃">
              <LogOut aria-hidden size={16} />
            </Button>
          </form>
        </div>
      </header>
      <div className="ac-admin-body">
        <nav className="ac-lnb" aria-label="하위 메뉴">
          {current ? <span className="ac-lnb__section">{current.name}</span> : null}
          {current?.screens.map((s) => {
            const section = s.section !== lastSection ? s.section : undefined;
            lastSection = s.section;
            return (
              <div key={s.screenId}>
                {section ? <span className="ac-lnb__section">{section}</span> : null}
                <Link href={s.href} aria-current={pathname.startsWith(s.href) ? 'page' : undefined}>
                  {s.name}
                </Link>
              </div>
            );
          })}
        </nav>
        <main className="ac-admin-main">
          {current && currentScreen ? (
            <p className="ac-breadcrumb">
              {current.name} &gt; {currentScreen.name}
            </p>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
