// T-NTC-010 공지사항 목록 · F-TEC-HOM-01: 유형 필터(전체·안전·거점), 필독(안전·고정·팝업) 표시, 읽음 여부
import { Card, Empty, Tag } from '@aircon/ui';
import Link from 'next/link';
import { formatDateTime } from '@/customer/format';
import { loadCodes } from '@/server/codes';
import { techNotices } from '@/server/content';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';

export const metadata = { title: '공지사항' };
export const dynamic = 'force-dynamic';

const FILTERS = [
  { value: '', label: '전체' },
  { value: 'SAFETY', label: '안전' },
  { value: 'BRANCH', label: '거점' },
];

export default async function TechNoticesPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const me = await requireTech();
  const { type } = await searchParams;
  const [all, codes] = await Promise.all([techNotices(me), loadCodes(['NOTICE_TYPE'])]);
  const rows = type === 'SAFETY' || type === 'BRANCH' ? all.filter((n) => n.noticeType === type) : all;
  return (
    <main className="tec-page__body">
      <TechTopbar title="공지사항" back={{ href: '/tech', label: '홈' }} />
      <div className="ac-chip-row" role="group" aria-label="공지 유형">
        {FILTERS.map((f) => (
          <Link key={f.value} href={f.value ? `/tech/notices?type=${f.value}` : '/tech/notices'} className="ac-chip" aria-pressed={(type ?? '') === f.value}>
            {f.label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty>등록된 공지가 없습니다.</Empty>
      ) : (
        <Card>
          <ul className="ac-list">
            {rows.map((n) => (
              <li key={n.id} className="ac-list-item">
                <Link href={`/tech/notices/${n.id}`} className="ac-list-item__body">
                  {n.required ? <Tag tone="danger">필독</Tag> : null} {!n.read ? <Tag tone="primary">새 글</Tag> : null}{' '}
                  <span className="ac-caption">{codes.NOTICE_TYPE?.find((c) => c.value === n.noticeType)?.label}</span>
                  <div className="ac-body">{n.title}</div>
                  <span className="ac-caption ac-num">{n.publishFrom ? formatDateTime(n.publishFrom) : ''}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
