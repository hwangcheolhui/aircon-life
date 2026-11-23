'use client';
// 고객 하단 탭 (03 §2.1: 홈 · 내 예약 · 마이). 스텝 플로우(견적·예약·로그인)에서는 숨긴다.
import { CalendarDays, House, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: '홈', icon: House, match: (p: string) => p === '/' || p === '/notifications' },
  { href: '/orders', label: '내 예약', icon: CalendarDays, match: (p: string) => p.startsWith('/orders') },
  { href: '/my', label: '마이', icon: UserRound, match: (p: string) => p.startsWith('/my') || p.startsWith('/cs') },
];

export function CustomerTabbar() {
  const path = usePathname() ?? '/';
  return (
    <nav className="cus-shell__nav" aria-label="주 메뉴">
      <div className="ac-tabbar">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.match(path) ? 'page' : undefined}>
            <t.icon aria-hidden />
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
