'use client';
// 기사 앱 하단 탭 (03 §3.1). 지금 열린 탭만 보여 준다: 홈 · 작업 · 더보기 (캘린더 단계 10, 정산 단계 7에서 추가)
import { ClipboardList, House, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/tech', label: '홈', icon: House, match: (p: string) => p === '/tech' },
  { href: '/tech/jobs', label: '작업', icon: ClipboardList, match: (p: string) => p.startsWith('/tech/jobs') },
  { href: '/tech/more', label: '더보기', icon: Menu, match: (p: string) => p.startsWith('/tech/more') || p.startsWith('/tech/my') || p.startsWith('/tech/notifications') },
];

export function TechTabbar() {
  const path = usePathname() ?? '/tech';
  return (
    <nav className="tec-shell__nav" aria-label="주 메뉴">
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
