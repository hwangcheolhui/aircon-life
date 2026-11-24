// T-WRK-030 처리 결과 · F-TEC-WRK-04(기기별 결과·기기 상태·차기 권장) · F-TEC-WRK-10(발견 이슈·수리 안내). 현장 기기 추가는 단계 5-2(금액 변경)
import { SETTING_KEYS } from '@aircon/domain';
import { loadCodes } from '@/server/codes';
import { getSettingNumber } from '@/server/settings';
import { ResultStep } from '@/tech/work/work-forms';
import { WorkSteps } from '@/tech/work/work-steps';
import { loadStep } from '../load';

export const metadata = { title: '처리 결과' };

export default async function WorkResultPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const { s } = await loadStep(orderNo, 'result');
  const [codes, revisit] = await Promise.all([loadCodes(['WORK_RESULT', 'DIRT_LEVEL']), getSettingNumber(SETTING_KEYS.REVISIT_MONTHS)]);
  return (
    <main className="tec-page__body">
      <WorkSteps orderNo={orderNo} current="result" title="처리 결과" />
      <ResultStep
        orderNo={orderNo}
        units={s.units}
        resultCodes={codes.WORK_RESULT ?? []}
        dirtCodes={codes.DIRT_LEVEL ?? []}
        defaultRecommend={revisit}
        initial={{
          dirtLevel: s.work?.dirtLevel ?? null,
          issueFound: s.work?.issueFound ?? null,
          repairGuided: s.work?.repairGuided ?? false,
          results: s.results,
        }}
      />
    </main>
  );
}
