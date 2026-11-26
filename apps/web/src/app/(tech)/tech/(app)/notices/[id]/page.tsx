// T-NTC-010 공지 상세 · F-TEC-HOM-01: 열면 읽음 1행(notice_read) — 관리자 A-CNT-010 읽음 현황에 반영
import { Card } from '@aircon/ui';
import { notFound } from 'next/navigation';
import { formatDateTime } from '@/customer/format';
import { loadCodes } from '@/server/codes';
import { readTechNotice } from '@/server/content';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';

export const metadata = { title: '공지' };
export const dynamic = 'force-dynamic';

export default async function TechNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTech();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const [n, codes] = await Promise.all([readTechNotice(me, id), loadCodes(['NOTICE_TYPE'])]);
  if (!n) notFound();
  return (
    <main className="tec-page__body">
      <TechTopbar title="공지" back={{ href: '/tech/notices', label: '공지사항' }} />
      <Card>
        <p className="ac-caption">
          {codes.NOTICE_TYPE?.find((c) => c.value === n.noticeType)?.label} · <span className="ac-num">{n.publishFrom ? formatDateTime(n.publishFrom) : ''}</span>
        </p>
        <h2 className="ac-h3">{n.title}</h2>
        <p className="ac-body tec-notice-body">{n.content}</p>
      </Card>
    </main>
  );
}
