// T-WRK-040 추가요금 · F-TEC-WRK-05: 규칙 선택/자재/기타(사유·증빙, 관리자 승인 BR-042)/현장 기기 추가 → 고객 동의 요청(앱) 또는 현장 서명(BR-040)
import { notFound } from 'next/navigation';
import { loadCodes } from '@/server/codes';
import { getExtraScreen } from '@/server/extra-charges';
import { ExtraBoard } from '@/tech/work/extra-board';
import { WorkSteps } from '@/tech/work/work-steps';
import { loadStep } from '../load';

export const metadata = { title: '추가요금' };

export default async function WorkExtraPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const { me } = await loadStep(orderNo, 'extra');
  const [s, codes] = await Promise.all([getExtraScreen(me.id, orderNo).catch(() => null), loadCodes(['EXTRA_CHARGE_TYPE'])]);
  if (!s) notFound();
  return (
    <main className="tec-page__body">
      <WorkSteps orderNo={orderNo} current="extra" title="추가요금" />
      <ExtraBoard s={s} types={codes.EXTRA_CHARGE_TYPE ?? []} />
    </main>
  );
}
