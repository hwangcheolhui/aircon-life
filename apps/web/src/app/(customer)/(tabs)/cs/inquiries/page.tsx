// C-CS-020 1:1 문의 · F-CUS-CS-02: 문의 목록·작성·답변 확인. 답변은 관리자 A-CSL-080, 답변 시 알림(INQUIRY_ANSWERED)
import { Card, Tag } from '@aircon/ui';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { formatDateTime } from '@/customer/format';
import { loadCodes } from '@/server/codes';
import { requireCustomer } from '@/server/customer-session';
import { listCustomerInquiries } from '@/server/inquiries';
import { InquiryForm } from './inquiry-form';

export const metadata = { title: '1:1 문의' };
export const dynamic = 'force-dynamic';

export default async function InquiriesPage() {
  const me = await requireCustomer('/cs/inquiries');
  const [rows, codes] = await Promise.all([me.demo ? Promise.resolve([]) : listCustomerInquiries(me.id), loadCodes(['INQUIRY_SUB_TYPE'])]);
  const label = (v: string | null) => codes.INQUIRY_SUB_TYPE?.find((c) => c.value === v)?.label ?? v ?? '';
  return (
    <main className="cus-page-body">
      <div className="cus-topbar">
        <Link href="/cs" className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="고객센터">
          <ChevronLeft aria-hidden />
        </Link>
      </div>
      <h1 className="ac-h2">1:1 문의</h1>
      <InquiryForm types={codes.INQUIRY_SUB_TYPE ?? []} disabled={me.demo} />
      <Card>
        <h2 className="ac-h3 cus-card-title">내 문의</h2>
        {rows.length === 0 ? (
          <p className="ac-body-sm">조회 결과가 없습니다.</p>
        ) : (
          rows.map((r) => (
            <article key={r.id} className="cus-inquiry">
              <div>
                {r.status === 'DONE' ? <Tag tone="success">답변 완료</Tag> : <Tag tone="warning">답변 대기</Tag>} <span className="ac-caption">{label(r.subType)}</span>{' '}
                <span className="ac-caption ac-num">{formatDateTime(new Date(r.createdAt))}</span>
                {r.orderNo ? <span className="ac-caption ac-num"> · {r.orderNo}</span> : null}
              </div>
              <p className="ac-body">{r.content}</p>
              {r.replyContent ? <p className="ac-body-sm cus-reply">{r.replyContent}</p> : null}
            </article>
          ))
        )}
      </Card>
    </main>
  );
}
