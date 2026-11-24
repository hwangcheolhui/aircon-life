'use client';
// T-WRK-060 처리 저장 · F-TEC-WRK-07: 필수값 체크 결과, 처리 내용, 금액 요약, 고객 서명(서명 패드) → [작업 완료] = WORK_DONE
// 필수 검증은 서버(checkCompletion, BR-041·043)가 다시 한다. 사진 업로드가 남아 있으면 완료를 막는다(오프라인 동기화 후).
import { Alert, Button, Field, Textarea, useToast } from '@aircon/ui';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { completeJob } from '@/app/(tech)/tech/(flow)/actions';
import { formatWon } from '@/customer/format';
import { countQueued } from './photo-queue';
import { SignaturePad, type SignatureRead } from './signature-pad';

export function CompleteForm({
  orderNo,
  problems: serverProblems,
  noteMinLength,
  amount,
  initialNote,
}: {
  orderNo: string;
  /** 처리 내용 글자 수를 뺀 서버 검증 결과 */
  problems: string[];
  noteMinLength: number;
  amount: number;
  initialNote: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const draftKey = `ac-work-note:${orderNo}`;
  const [note, setNote] = useState(initialNote);
  const [internal, setInternal] = useState('');
  const readSignature = useRef<SignatureRead | null>(null);
  const [problems, setProblems] = useState(serverProblems);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [queued, setQueued] = useState(0);
  useEffect(() => {
    void countQueued(orderNo).then(setQueued);
  }, [orderNo]);
  // 처리 내용 임시 저장(브라우저): 오프라인·새로고침에도 남는다
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved && !initialNote) setNote(saved);
    } catch {
      // 브라우저 저장소를 못 쓰면 임시 저장 없이 진행
    }
  }, [draftKey, initialNote]);
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, note);
    } catch {
      // 브라우저 저장소를 못 쓰면 임시 저장 없이 진행
    }
  }, [draftKey, note]);
  const noteLen = note.replace(/\s/g, '').length;
  const all = [
    ...problems,
    ...(queued ? [`아직 올라가지 않은 사진이 ${queued}장 있습니다. 사진 화면에서 업로드를 마쳐 주세요.`] : []),
    ...(noteLen < noteMinLength ? [`처리 내용을 ${noteMinLength}자 이상 입력해 주세요.`] : [])];
  return (
    <>
      <section className="ac-card tec-section" aria-labelledby="check-title">
        <h2 id="check-title" className="ac-h3">
          필수값 확인
        </h2>
        {all.length ? (
          <ul className="ac-list">
            {all.map((p) => (
              <li key={p} className="ac-list-item tec-check-item is-missing">
                <CircleAlert aria-hidden /> <span>{p}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ac-body tec-check-item">
            <CircleCheck aria-hidden /> 사진·결과·안전 체크를 모두 마쳤습니다.
          </p>
        )}
      </section>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="처리 내용" required help={`고객 작업 리포트에 보입니다. ${noteMinLength}자 이상 (지금 ${noteLen}자)`}>
        {(id, d, inv) => (
          <Textarea id={id} aria-describedby={d} aria-invalid={inv} rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        )}
      </Field>
      <Field label="내부 메모" help="운영자만 봅니다.">
        {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} maxLength={2000} value={internal} onChange={(e) => setInternal(e.target.value)} />}
      </Field>
      <section className="tec-section" aria-labelledby="sig-title">
        <h2 id="sig-title" className="ac-h3">
          고객 확인 서명 <span className="ac-caption">(선택)</span>
        </h2>
        <SignaturePad readRef={readSignature} />
      </section>
      <div className="ac-bottom-bar">
        <div className="ac-bottom-bar__price">
          <span className="ac-caption">청구 금액</span>
          <strong className="ac-num">{formatWon(amount)}</strong>
        </div>
        <Button
          variant="primary"
          size="lg"
          disabled={all.length > 0}
          loading={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const form = new FormData();
              form.set('orderNo', orderNo);
              form.set('workNote', note);
              form.set('internalNote', internal);
              const signature = (await readSignature.current?.()) ?? null;
              if (signature) form.set('signature', new File([signature], 'signature.png', { type: 'image/png' }));
              const r = await completeJob(form);
              if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '저장하지 못했습니다.');
              const d = r.data as { done: boolean; problems?: string[] };
              if (!d.done) return setProblems(d.problems ?? []);
              try {
                localStorage.removeItem(draftKey);
              } catch {
                // 브라우저 저장소를 못 쓰면 임시 저장 없이 진행
              }
              toast('작업을 완료했습니다. 고객에게 작업 리포트를 보냈습니다.');
              router.push(`/tech/jobs/${orderNo}/pay`);
            })
          }
        >
          작업 완료
        </Button>
      </div>
    </>
  );
}
