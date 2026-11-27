// C-REV-010 후기 작성 (단계 9) · F-CUS-REV-01: 별점·추천의향(0~10)·태그·사진·내용, 완료 후 REVIEW_WRITABLE_DAYS 일 안. 저평점은 VOC 자동 생성(BR-090)
import { Alert, Card, Tag } from '@aircon/ui';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadCodes } from '@/server/codes';
import { requireCustomer } from '@/server/customer-session';
import { customerReviewInfo } from '@/server/reviews';
import { ReviewForm } from './review-form';

export const metadata = { title: '후기 작성' };
export const dynamic = 'force-dynamic';

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ orderNo: string }>; searchParams: Promise<{ done?: string }> }) {
  const { orderNo } = await params;
  const { done } = await searchParams;
  const me = await requireCustomer(`/orders/${orderNo}/review`);
  const info = me.demo ? null : await customerReviewInfo(me.id, orderNo);
  if (!info) notFound();
  const codes = await loadCodes(['REVIEW_TAG']);
  const tagLabel = (v: string) => codes.REVIEW_TAG?.find((c) => c.value === v)?.label ?? v;
  return (
    <main className="cus-page-body">
      <div className="cus-topbar">
        <Link href={`/orders/${orderNo}`} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="예약 상세">
          <ChevronLeft aria-hidden />
        </Link>
        <span className="ac-caption ac-num">{orderNo}</span>
      </div>
      <h1 className="ac-h2">후기 작성</h1>
      {done ? <Alert tone="success">소중한 후기 고마워요. 더 좋은 서비스로 보답할게요.</Alert> : null}
      {info.review ? (
        <Card>
          <p className="ac-body">
            별점 <strong className="ac-num">{info.review.rating}</strong>점{info.review.npsScore !== null ? <> · 추천 의향 <span className="ac-num">{info.review.npsScore}</span>점</> : null}
          </p>
          {info.review.tags.length ? (
            <div className="ac-row">
              {info.review.tags.map((t) => (
                <Tag key={t}>{tagLabel(t)}</Tag>
              ))}
            </div>
          ) : null}
          {info.review.content ? <p className="ac-body-sm cus-reply">{info.review.content}</p> : null}
          {info.review.adminReply ? (
            <>
              <h2 className="ac-h3">답글</h2>
              <p className="ac-body-sm cus-reply">{info.review.adminReply}</p>
            </>
          ) : null}
        </Card>
      ) : info.window.ok ? (
        <>
          <p className="ac-body-sm">
            <span className="ac-num">{info.window.until}</span>까지 남길 수 있어요.
          </p>
          <ReviewForm orderNo={orderNo} tags={codes.REVIEW_TAG ?? []} />
        </>
      ) : (
        <p className="ac-body-sm">{info.window.reason}</p>
      )}
    </main>
  );
}
