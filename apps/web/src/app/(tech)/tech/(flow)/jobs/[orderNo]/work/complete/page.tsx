// T-WRK-060 처리 저장 · F-TEC-WRK-07: 필수값 체크(BR-041 전후 사진·결과·BR-043 안전·추가요금 응답·처리 내용) → 처리 내용 → 고객 서명 → WORK_DONE
// 청구 금액 = 작업비 + 고객이 동의한 추가요금(BR-040)
// 결제(T-PAY-010)는 단계 6. 완료 후에는 작업 상세로 돌아간다.
import { SETTING_KEYS } from '@aircon/domain';
import { getSettingNumber } from '@/server/settings';
import { completionCheck, extrasOf } from '@/server/work';
import { CompleteForm } from '@/tech/work/complete-form';
import { WorkSteps } from '@/tech/work/work-steps';
import { loadStep } from '../load';

export const metadata = { title: '처리 저장' };

export default async function WorkCompletePage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const { s } = await loadStep(orderNo, 'complete');
  const [check, min, extras] = await Promise.all([
    completionCheck(s, null),
    getSettingNumber(SETTING_KEYS.WORK_NOTE_MIN_LENGTH),
    extrasOf(s.work?.id ?? null),
  ]);
  return (
    <main className="tec-page__body">
      <WorkSteps orderNo={orderNo} current="complete" title="처리 저장" />
      <CompleteForm
        orderNo={orderNo}
        problems={check.problems.filter((p) => p.code !== 'NOTE_SHORT').map((p) => p.message)}
        noteMinLength={min}
        amount={s.totalAmount + extras.agreed}
        initialNote={s.work?.workNote ?? ''}
      />
    </main>
  );
}
