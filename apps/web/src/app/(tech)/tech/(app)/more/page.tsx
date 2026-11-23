// T-MORE-010 더보기: 지금 열린 메뉴(내 정보·알림) + 로그아웃. 자재·기술자료·교육·공지·퀵메뉴는 해당 단계에서 추가
import { Bell, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';
import { logoutTech } from '../actions';

export const metadata = { title: '더보기' };

export default async function TechMorePage() {
  await requireTech();
  return (
    <main className="tec-page__body">
      <TechTopbar title="더보기" />
      <nav className="tec-menu-grid" aria-label="더보기 메뉴">
        <Link href="/tech/my">
          <UserRound aria-hidden />내 정보
        </Link>
        <Link href="/tech/notifications">
          <Bell aria-hidden />
          알림
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
