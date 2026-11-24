'use client';
// 현장작업 스텝 화면의 입력 부분 (단계 5-1)
// - MoveStep: T-WRK-010 [출발](F-TEC-WRK-01, 코스 순서와 다르면 확인) → [도착](F-TEC-WRK-02)
// - SafetyStep: T-WRK-011 안전 체크리스트(BR-043) → [작업 시작]
// - ResultStep: T-WRK-030 기기별 결과·기기 상태·차기 권장, 오염도, 발견 이슈·수리 안내(F-TEC-WRK-04·10)
import { Alert, Button, Check, Field, Input, Modal, Select, Textarea, useToast } from '@aircon/ui';
import { Navigation } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { arriveJob, departJob, saveWorkResults, startJob } from '@/app/(tech)/tech/(flow)/actions';

type Code = { value: string; label: string };

export function MoveStep({ orderNo, status, roadAddress, canAct }: { orderNo: string; status: string | null; roadAddress: string; canAct: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const departed = status === 'ON_THE_WAY';
  const go = (force: boolean) =>
    start(async () => {
      setError(null);
      const r = await departJob({ orderNo, force });
      if (!r.ok) return setError(r.message ?? '출발 처리하지 못했습니다.');
      const d = r.data as { departed: boolean; confirm?: string };
      if (!d.departed) return setConfirm(d.confirm ?? null);
      setConfirm(null);
      toast('출발했습니다. 고객에게 도착 예정 시간을 안내했습니다.');
      router.refresh();
    });
  return (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <a
        href={`https://map.kakao.com/link/search/${encodeURIComponent(roadAddress)}`}
        target="_blank"
        rel="noreferrer"
        className="ac-btn ac-btn--outline ac-btn--lg ac-btn--block"
      >
        <Navigation aria-hidden /> 길찾기
      </a>
      {!canAct ? (
        <Alert>출발·도착·완료는 주기사가 처리합니다.</Alert>
      ) : departed ? (
        <Button
          variant="primary"
          size="xl"
          block
          loading={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await arriveJob({ orderNo });
              if (!r.ok) return setError(r.message ?? '도착 처리하지 못했습니다.');
              router.push(`/tech/jobs/${orderNo}/work/safety`);
            })
          }
        >
          도착
        </Button>
      ) : (
        <Button variant="primary" size="xl" block loading={pending} onClick={() => go(false)}>
          출발
        </Button>
      )}
      <Modal
        open={confirm !== null}
        title="코스 순서와 다릅니다"
        description={confirm ?? ''}
        onClose={() => setConfirm(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              닫기
            </Button>
            <Button variant="primary" loading={pending} onClick={() => go(true)}>
              이 작업으로 출발
            </Button>
          </>
        }
      />
    </>
  );
}

export function SafetyStep({ orderNo, items, teamSize }: { orderNo: string; items: Code[]; teamSize: number }) {
  const router = useRouter();
  const [checked, setChecked] = useState<string[]>([]);
  const [high, setHigh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const all = items.every((i) => checked.includes(i.value));
  return (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <fieldset className="tec-checklist">
        <legend className="ac-h3">작업 전 안전 확인</legend>
        {items.map((i) => (
          <Check
            key={i.value}
            label={i.label}
            checked={checked.includes(i.value)}
            onChange={(e) => setChecked((c) => (e.target.checked ? [...c, i.value] : c.filter((x) => x !== i.value)))}
          />
        ))}
      </fieldset>
      <fieldset className="tec-checklist">
        <legend className="ac-h3">작업 환경</legend>
        <Check label="고소작업이 있습니다 (사다리·높은 곳)" checked={high} onChange={(e) => setHigh(e.target.checked)} />
      </fieldset>
      {high && teamSize < 2 ? <Alert tone="warning">고소작업은 2인 이상 작업을 권장합니다. 혼자라면 사다리를 고정하고 추락에 주의해 주세요.</Alert> : null}
      {!all ? <p className="ac-caption">모든 항목을 확인해야 작업을 시작할 수 있습니다.</p> : null}
      <Button
        variant="primary"
        size="xl"
        block
        disabled={!all}
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startJob({ orderNo, checked, highPlaceWork: high });
            if (!r.ok) return setError(r.message ?? '작업을 시작하지 못했습니다.');
            router.push(`/tech/jobs/${orderNo}/work/photos`);
          })
        }
      >
        작업 시작
      </Button>
    </>
  );
}

interface UnitResult {
  orderItemId: number;
  unitNo: number;
  label: string;
  result: string;
  conditionNote: string;
  recommendNext: string;
}

export function ResultStep({
  orderNo,
  units,
  resultCodes,
  dirtCodes,
  initial,
  defaultRecommend,
}: {
  orderNo: string;
  units: { orderItemId: number; unitNo: number; label: string }[];
  resultCodes: Code[];
  dirtCodes: Code[];
  initial: {
    dirtLevel: string | null;
    issueFound: string | null;
    repairGuided: boolean;
    results: { orderItemId: number; unitNo: number; result: string; conditionNote: string | null; recommendNext: number | null }[];
  };
  defaultRecommend: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<UnitResult[]>(() =>
    units.map((u) => {
      const r = initial.results.find((x) => x.orderItemId === u.orderItemId && x.unitNo === u.unitNo);
      return {
        ...u,
        result: r?.result ?? '',
        conditionNote: r?.conditionNote ?? '',
        recommendNext: String(r?.recommendNext ?? defaultRecommend),
      };
    }),
  );
  const [dirt, setDirt] = useState(initial.dirtLevel ?? '');
  const [issue, setIssue] = useState(initial.issueFound ?? '');
  const [repair, setRepair] = useState(initial.repairGuided);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<UnitResult>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const missing = rows.filter((r) => !r.result).map((r) => r.label);
  return (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {rows.map((r, i) => (
        <section key={`${r.orderItemId}:${r.unitNo}`} className="ac-card tec-section" aria-label={`${r.label} 처리 결과`}>
          <h2 className="ac-h3">{r.label}</h2>
          <div className="ac-segmented" role="group" aria-label={`${r.label} 결과`}>
            {resultCodes.map((c) => (
              <button key={c.value} type="button" aria-pressed={r.result === c.value} onClick={() => set(i, { result: c.value })}>
                {c.label}
              </button>
            ))}
          </div>
          <Field label={r.result === 'SKIPPED' ? '작업하지 못한 사유' : '기기 상태'}>
            {(id, d) => (
              <Input id={id} aria-describedby={d} value={r.conditionNote} maxLength={300} onChange={(e) => set(i, { conditionNote: e.target.value })} />
            )}
          </Field>
          {r.result !== 'SKIPPED' ? (
            <Field label="다음 청소 권장">
              {(id, d) => (
                <Select id={id} aria-describedby={d} value={r.recommendNext} onChange={(e) => set(i, { recommendNext: e.target.value })}>
                  {[3, 6, 12, 18, 24].map((m) => (
                    <option key={m} value={m}>
                      {m}개월 뒤
                    </option>
                  ))}
                  {[3, 6, 12, 18, 24].includes(Number(r.recommendNext)) ? null : <option value={r.recommendNext}>{r.recommendNext}개월 뒤</option>}
                </Select>
              )}
            </Field>
          ) : null}
        </section>
      ))}
      <section className="ac-card tec-section" aria-label="현장 판정">
        <Field label="오염도">
          {(id, d) => (
            <Select id={id} aria-describedby={d} value={dirt} onChange={(e) => setDirt(e.target.value)}>
              <option value="">선택</option>
              {dirtCodes.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="발견 이슈 (누수·전기 등)" help="고객 작업 리포트에 보입니다.">
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} maxLength={500} value={issue} onChange={(e) => setIssue(e.target.value)} />}
        </Field>
        <Check label="고객에게 수리를 안내했습니다" checked={repair} onChange={(e) => setRepair(e.target.checked)} />
      </section>
      {missing.length ? <p className="ac-caption">결과를 고르지 않은 기기: {missing.join(', ')}</p> : null}
      <Button
        variant="primary"
        size="xl"
        block
        disabled={missing.length > 0}
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await saveWorkResults({
              orderNo,
              dirtLevel: dirt,
              issueFound: issue,
              repairGuided: repair,
              units: rows.map((x) => ({
                orderItemId: x.orderItemId,
                unitNo: x.unitNo,
                result: x.result,
                conditionNote: x.conditionNote,
                recommendNext: x.result === 'SKIPPED' ? null : x.recommendNext,
              })),
            });
            if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '저장하지 못했습니다.');
            toast('저장에 성공하였습니다.');
            router.push(`/tech/jobs/${orderNo}/work/complete`);
          })
        }
      >
        저장하고 다음
      </Button>
    </>
  );
}
