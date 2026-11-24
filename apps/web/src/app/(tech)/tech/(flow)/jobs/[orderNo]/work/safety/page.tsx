// T-WRK-011 안전 체크리스트 · F-TEC-WRK-02 · BR-043: 고소·전기·보호구·약품 모두 확인해야 작업 시작, 고소작업 혼자면 2인 권장 경고
import { loadCodes } from '@/server/codes';
import { SafetyStep } from '@/tech/work/work-forms';
import { WorkSteps } from '@/tech/work/work-steps';
import { loadStep } from '../load';

export const metadata = { title: '안전 체크리스트' };

export default async function WorkSafetyPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const { s } = await loadStep(orderNo, 'safety');
  const codes = await loadCodes(['SAFETY_CHECK']);
  return (
    <main className="tec-page__body">
      <WorkSteps orderNo={orderNo} current="safety" title="안전 체크리스트" />
      <SafetyStep orderNo={orderNo} items={codes.SAFETY_CHECK ?? []} teamSize={s.teamSize} />
    </main>
  );
}
