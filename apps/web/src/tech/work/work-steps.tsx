// 현장작업 풀스크린 스텝 플로우 상단 (03 §3.2 T-WRK S1~S7): 제목 + 진행바(.ac-progress) + 단계 이름(.ac-steps)
// 출발·도착(T-WRK-010) → 안전(T-WRK-011) → 사진(T-WRK-020) → 결과(T-WRK-030) → 추가요금(T-WRK-040, 단계 5-2) → 완료(T-WRK-060).
// 미처리 저장(T-WRK-061)은 단계가 아니라 어느 단계에서든 들어가는 화면.
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

export const WORK_STEPS = [
  { key: 'move', label: '출발·도착', path: '' },
  { key: 'safety', label: '안전', path: '/safety' },
  { key: 'photos', label: '사진', path: '/photos' },
  { key: 'result', label: '결과', path: '/result' },
  { key: 'extra', label: '추가요금', path: '/extra' },
  { key: 'complete', label: '완료', path: '/complete' },
] as const;
export type WorkStepKey = (typeof WORK_STEPS)[number]['key'];

/** 작업 상태로 지금 있어야 할 단계 (READY·이동중 = 출발·도착, 도착 = 안전, 작업중 = 사진~완료 자유 이동) */
export function stepForStatus(status: string | null): WorkStepKey | 'done' {
  if (!status || status === 'READY' || status === 'ON_THE_WAY') return 'move';
  if (status === 'ARRIVED') return 'safety';
  if (status === 'IN_PROGRESS') return 'photos';
  return 'done';
}

export function WorkSteps({ orderNo, current, title }: { orderNo: string; current: WorkStepKey; title: string }) {
  const idx = WORK_STEPS.findIndex((s) => s.key === current);
  return (
    <header className="tec-flow__head">
      <div className="tec-topbar">
        <Link href={`/tech/jobs/${orderNo}`} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="작업 상세">
          <ChevronLeft aria-hidden />
        </Link>
        <h1 className="ac-h2 tec-topbar__title">{title}</h1>
        <span className="ac-caption ac-num">{orderNo}</span>
        <Link href={`/tech/jobs/${orderNo}/work/pending`} className="ac-btn ac-btn--text ac-btn--sm">
          미처리
        </Link>
      </div>
      <div
        className="ac-progress"
        role="progressbar"
        aria-label="현장작업 진행"
        aria-valuemin={1}
        aria-valuemax={WORK_STEPS.length}
        aria-valuenow={idx + 1}
      >
        <span style={{ width: `${((idx + 1) / WORK_STEPS.length) * 100}%` }} />
      </div>
      <ol className="ac-steps">
        {WORK_STEPS.map((s, i) => (
          <li key={s.key} className={i === idx ? 'is-current' : undefined} aria-current={i === idx ? 'step' : undefined}>
            {s.label}
          </li>
        ))}
      </ol>
    </header>
  );
}
