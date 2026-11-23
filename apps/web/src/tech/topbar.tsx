// 기사 앱 상단 바: 제목 + 뒤로가기(선택) + 알림(T-NTF-010) 아이콘 버튼
import { Bell, ChevronLeft } from 'lucide-react';
import Link from 'next/link';

export function TechTopbar({ title, back }: { title: string; back?: { href: string; label: string } }) {
  return (
    <header className="tec-topbar">
      {back ? (
        <Link href={back.href} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label={back.label}>
          <ChevronLeft aria-hidden />
        </Link>
      ) : null}
      <h1 className="ac-h2 tec-topbar__title">{title}</h1>
      <Link href="/tech/notifications" className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="알림">
        <Bell aria-hidden />
      </Link>
    </header>
  );
}
