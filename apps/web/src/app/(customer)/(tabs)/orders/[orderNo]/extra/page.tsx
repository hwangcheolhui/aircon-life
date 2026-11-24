// C-ORD-040 추가요금 동의 · F-CUS-ORD-04 (BR-040): 기사가 등록한 추가요금의 항목·사유·증빙 사진을 보고 [동의]/[거절]. 거절하면 청구되지 않는다.
// 기타(ETC) 추가요금은 관리자 승인 후에만 여기 보인다(BR-042). 알림톡 링크로 들어온다.
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExtraConsent } from '@/customer/extra-consent';
import { requireCustomer } from '@/server/customer-session';
import { customerExtraCharges } from '@/server/extra-charges';

export const metadata = { title: '추가요금 동의' };
export const dynamic = 'force-dynamic';

export default async function ExtraConsentPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const me = await requireCustomer(`/orders/${orderNo}/extra`);
  const x = me.demo ? null : await customerExtraCharges(me.id, orderNo);
  if (!x) notFound();
  return (
    <main className="cus-page-body">
      <div className="cus-topbar">
        <Link href={`/orders/${x.orderNo}`} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="예약 상세">
          <ChevronLeft aria-hidden />
        </Link>
        <span className="ac-caption ac-num">{x.orderNo}</span>
      </div>
      <div>
        <h1 className="ac-h2">추가요금 동의</h1>
        <p className="ac-caption">현장에서 기사님이 요청한 추가 작업이에요. 동의한 항목만 청구되고, 거절하면 그 작업은 하지 않아요.</p>
      </div>
      <ExtraConsent orderNo={x.orderNo} charges={x.charges} canRespond={x.canRespond} agreed={x.agreed} />
    </main>
  );
}
