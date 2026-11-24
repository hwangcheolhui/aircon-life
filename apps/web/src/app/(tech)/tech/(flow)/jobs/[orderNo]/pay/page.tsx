// T-PAY-010 현장 결제 / 수금 확인 · F-TEC-PAY-01·02 (BR-082): 최종 금액 → [앱 결제 요청][결제 링크][카드단말][계좌][현금], 수금 입력.
// T-PAY-020 증빙 발행(하단 시트) · F-TEC-PAY-03. 전액 결제되면 주문이 자동으로 완료(01 §3.1)되고 정산 대상이 된다(BR-081).
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { loadCodes } from '@/server/codes';
import { getTechPayment } from '@/server/payments';
import { requireTech } from '@/server/tech-session';
import { myAssignment } from '@/server/tech-jobs';
import { PayBoard } from '@/tech/work/pay-board';

export const metadata = { title: '현장 결제' };
export const dynamic = 'force-dynamic';

export default async function TechPayPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const me = await requireTech();
  const m = await myAssignment(me.id, orderNo);
  if (!m) notFound();
  if (m.a.role !== 'MAIN' || !['WORK_DONE', 'COMPLETED'].includes(m.o.status))
    redirect(`/tech/jobs/${orderNo}`);
  const [s, codes] = await Promise.all([
    getTechPayment(me.id, orderNo),
    loadCodes(['PAYMENT_METHOD', 'TAX_DOC_TYPE', 'TAX_ISSUE_STATUS']),
  ]);
  return (
    <main className="tec-page__body">
      <header className="tec-flow__head">
        <div className="tec-topbar">
          <Link
            href={`/tech/jobs/${orderNo}`}
            className="ac-btn ac-btn--ghost ac-btn--icon"
            aria-label="작업 상세"
          >
            <ChevronLeft aria-hidden />
          </Link>
          <h1 className="ac-h2 tec-topbar__title">현장 결제</h1>
          <span className="ac-caption ac-num">{orderNo}</span>
        </div>
      </header>
      <PayBoard s={s} codes={codes} />
    </main>
  );
}
