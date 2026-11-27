import 'server-only';
// 현장작업 스텝 화면 공통: 내 작업 확인 + 작업 상태에 맞지 않는 단계면 맞는 단계로 보낸다
import { notFound, redirect } from 'next/navigation';
import { requireTech } from '@/server/tech-session';
import { getWorkState } from '@/server/work';
import { WORK_STEPS, type WorkStepKey, stepForStatus } from '@/tech/work/work-steps';

export async function loadStep(orderNo: string, step: WorkStepKey) {
  const me = await requireTech();
  const s = await getWorkState(me.id, orderNo);
  if (!s) notFound();
  const want = stepForStatus(s.work?.status ?? null);
  if (want === 'done') redirect(`/tech/jobs/${orderNo}`);
  // 작업중이면 사진·결과·완료 사이는 자유롭게, 그 전 단계로는 돌아가지 않는다
  const free = want === 'photos' && (step === 'photos' || step === 'result' || step === 'extra' || step === 'materials' || step === 'complete');
  if (!free && want !== step) redirect(`/tech/jobs/${orderNo}/work${WORK_STEPS.find((x) => x.key === want)!.path}`);
  return { me, s };
}
