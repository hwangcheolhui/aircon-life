'use client';
// 관리자 GNB/LNB 셸 (.ac-gnb / .ac-lnb, 05 §6.4)
import { Alert, Button } from '@aircon/ui';
import { KeyRound, LogIn, LogOut } from 'lucide-react';
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
  previewMode = false,
  dbOffline = false,
  children,
}: {
  menu: ShellMenuGroup[];
  user: { name: string; roleName: string };
  branchSelector: BranchSelector;
  /** 임시 개발 모드(로그인 없이 읽기 전용 열람) */
  previewMode?: boolean;
  /** DATABASE_URL 미설정: 데이터 없이 화면 틀만 보여 준다 */
  dbOffline?: boolean;
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
          {previewMode ? (
            <Link href="/admin/login" className="ac-btn ac-btn--outline ac-btn--sm">
              <LogIn aria-hidden size={16} />
              로그인
            </Link>
          ) : (
            <>
              <Link href="/admin/password" className="ac-btn ac-btn--ghost ac-btn--sm ac-btn--icon" aria-label="비밀번호 변경">
                <KeyRound aria-hidden size={16} />
              </Link>
              <form action={logoutAction}>
                <Button type="submit" variant="ghost" size="sm" icon aria-label="로그아웃">
                  <LogOut aria-hidden size={16} />
                </Button>
              </form>
            </>
          )}
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
          {previewMode || dbOffline ? (
            <div className="ac-stack">
              {previewMode ? (
                <Alert tone="warning">
                  <strong>임시 개발 모드</strong> · 로그인 없이 읽기 전용으로 보고 있습니다. 저장·수정·삭제와 개인정보 원문 열람은 로그인해야 합니다.
                </Alert>
              ) : null}
              {dbOffline ? (
                <Alert tone="warning">
                  <strong>DB 미연결</strong> · 데이터베이스가 아직 연결되지 않아 목록이 비어 있습니다. 코드 표시명·기준값은 기본 시드를 보여 줍니다.
                </Alert>
              ) : null}
            </div>
          ) : null}
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
