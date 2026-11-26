// T-NTF-020 독촉·전달 상세 · F-TEC-NTF-02: 전달 내용·관련 작업·회신. 처음 열면 읽음(관리자 A-PRC-060에 읽은 시각 표시)
import { Card, Tag } from '@aircon/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDateTime } from '@/customer/format';
import { loadCodes } from '@/server/codes';
import { openTechFollowup } from '@/server/followups';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';
import { ReplyForm } from './reply-form';

export const metadata = { title: '독촉·전달' };
export const dynamic = 'force-dynamic';

export default async function FollowupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTech();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const [f, codes] = await Promise.all([openTechFollowup(me.id, id), loadCodes(['FOLLOWUP_TYPE'])]);
  if (!f) notFound();
  return (
    <main className="tec-page__body">
      <TechTopbar title="독촉·전달" back={{ href: '/tech/notifications', label: '알림' }} />
      <Card>
        <p className="ac-caption">
          <Tag tone="warning">{f.followupCount}차</Tag> {codes.FOLLOWUP_TYPE?.find((c) => c.value === f.followupType)?.label ?? f.followupType} ·{' '}
          <span className="ac-num">{formatDateTime(f.createdAt)}</span>
        </p>
        <p className="ac-body-lg">{f.message}</p>
        {f.orderNo ? (
          <Link href={`/tech/jobs/${f.orderNo}`} className="ac-btn ac-btn--outline ac-btn--block ac-num">
            {f.orderNo} 작업 보기{f.promisedAt ? ` · ${formatDateTime(f.promisedAt)}` : ''}
          </Link>
        ) : null}
      </Card>
      {f.status === 'REPLIED' || f.status === 'CLOSED' ? (
        <Card>
          <h2 className="ac-h3">내 회신</h2>
          <p className="ac-body">{f.reply ?? '회신 없이 종결되었습니다.'}</p>
          {f.repliedAt ? <p className="ac-caption ac-num">{formatDateTime(f.repliedAt)}</p> : null}
        </Card>
      ) : (
        <ReplyForm id={f.id} />
      )}
    </main>
  );
}
