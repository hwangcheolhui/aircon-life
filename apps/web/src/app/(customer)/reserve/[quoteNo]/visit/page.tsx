// C-RSV-020 방문 정보 (S6) · F-CUS-RSV-02: 상세주소, 주거유형, 엘리베이터·주차, 요청사항
import { loadCodes } from '@/server/codes';
import { reserveContext } from '../../context';
import { VisitStep } from './visit-step';

export const metadata = { title: '방문 정보' };
export const dynamic = 'force-dynamic';

export default async function VisitPage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteNo: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { quoteNo } = await params;
  const { quote, r } = await reserveContext(quoteNo, (await searchParams).r, '/visit');
  const codes = await loadCodes(['HOUSING_TYPE']);
  return <VisitStep quoteNo={quote.quoteNo} r={r} amount={quote.totalAmount} housingTypes={codes.HOUSING_TYPE ?? []} />;
}
