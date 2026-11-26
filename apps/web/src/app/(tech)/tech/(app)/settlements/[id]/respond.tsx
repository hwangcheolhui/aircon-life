'use client';
// T-STL-020 [확인] / [이의 제기] (F-TEC-STL-02). 이의는 하단 시트에서 사유 필수.
import { Alert, Button, Field, MSG, Sheet, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { respondSettlement } from '../../actions';

type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

export function SettlementRespond({ settlementId }: { settlementId: number }) {
  const router = useRouter();
  const toast = useToast();
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (action: 'CONFIRM' | 'DISPUTE') => {
    setError(null);
    if (action === 'DISPUTE' && !note.trim()) return setError(MSG.required('이의 내용'));
    setBusy(true);
    const r = (await respondSettlement({ settlementId, action, note })) as Res;
    setBusy(false);
    if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '저장하지 못했습니다.');
    setDisputing(false);
    toast(action === 'CONFIRM' ? '정산을 확인했습니다.' : '이의를 보냈습니다. 정산 담당자가 확인 후 처리합니다.');
    router.refresh();
  };
  return (
    <div className="tec-section">
      {error && !disputing ? <Alert tone="danger">{error}</Alert> : null}
      <div className="tec-btn-row">
        <Button variant="outline" size="lg" onClick={() => setDisputing(true)}>
          이의 제기
        </Button>
        <Button variant="primary" size="lg" loading={busy && !disputing} onClick={() => send('CONFIRM')}>
          확인
        </Button>
      </div>
      {disputing ? (
        <Sheet title="이의 제기" onClose={() => setDisputing(false)} overlayClassName="tec-sheet-overlay">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="이의 내용" required help="빠진 작업·금액이 다른 건의 접수번호를 적어 주세요.">
            {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
          </Field>
          <Button variant="primary" size="lg" block loading={busy} onClick={() => send('DISPUTE')}>
            이의 보내기
          </Button>
        </Sheet>
      ) : null}
    </div>
  );
}
