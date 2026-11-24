// T-WRK-061 미처리 저장 · F-TEC-WRK-08 (BR-031): 어느 단계에서든(출발 전 배정완료 포함) 사유를 골라 미처리로 저장
import { kstDate } from '@aircon/domain';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { loadCodes } from '@/server/codes';
import { requireTech } from '@/server/tech-session';
import { myAssignment } from '@/server/tech-jobs';
import { absentStreakOf } from '@/server/work';
import { PendingForm } from '@/tech/work/pending-form';

export const metadata = { title: '미처리 저장' };
export const dynamic = 'force-dynamic';

export default async function WorkPendingPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const me = await requireTech();
  const m = await myAssignment(me.id, orderNo);
  if (!m) notFound();
  if (m.a.role !== 'MAIN' || !['ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS'].includes(m.o.status)) redirect(`/tech/jobs/${orderNo}`);
  const [codes, streak] = await Promise.all([loadCodes(['PENDING_REASON']), absentStreakOf(m.o.id)]);
  return (
    <main className="tec-page__body">
      <header className="tec-flow__head">
        <div className="tec-topbar">
          <Link href={`/tech/jobs/${orderNo}`} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="작업 상세">
            <ChevronLeft aria-hidden />
          </Link>
          <h1 className="ac-h2 tec-topbar__title">미처리 저장</h1>
          <span className="ac-caption ac-num">{orderNo}</span>
        </div>
      </header>
      <PendingForm orderNo={orderNo} reasons={codes.PENDING_REASON ?? []} today={kstDate(new Date())} absentStreak={streak} />
    </main>
  );
}
