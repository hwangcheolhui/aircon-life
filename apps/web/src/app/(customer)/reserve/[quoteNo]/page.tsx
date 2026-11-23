// C-RSV-010 일정 선택 (S5) · F-CUS-RSV-01: 14일 달력, 시간대 버튼(마감/할증 배지). 소요시간만큼 연속 슬롯에 잔여가 있는 시각만 고를 수 있다(BR-021).
import { Alert } from '@aircon/ui';
import Link from 'next/link';
import { getAvailability } from '@/server/slots';
import { reserveContext } from '../context';
import { ScheduleStep } from './schedule-step';

export const metadata = { title: '일정 선택' };
export const dynamic = 'force-dynamic';

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteNo: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { quoteNo } = await params;
  const { quote, r } = await reserveContext(quoteNo, (await searchParams).r);
  if (quote.blocked) {
    return (
      <main className="cus-flow__body">
        <Alert tone="warning">{quote.blocked}</Alert>
        <Link href="/quote" className="ac-btn ac-btn--primary">
          다시 견적 받기
        </Link>
      </main>
    );
  }
  const days = await getAvailability({ branchId: quote.branchId, durationMin: quote.durationMin });
  return <ScheduleStep quoteNo={quote.quoteNo} r={r} days={days} amount={quote.totalAmount} durationMin={quote.durationMin} />;
}
