'use client';
// C-AS-010 AS 요청 입력 (F-CUS-AS-01): 사유·내용 필수, 사진 3장까지(합계 3.5MB), 금액이 없는 화면이라 하단 바 대신 일반 버튼
import { Alert, Button, Card, ConfirmModal, Field, MSG, Textarea } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { submitAs } from '../../actions';

const MAX_TOTAL = 3.5 * 1024 * 1024;

export function AsForm({ orderNo, reasons }: { orderNo: string; reasons: { value: string; label: string }[] }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setConfirm(false);
    setBusy(true);
    const fd = new FormData();
    fd.set('orderNo', orderNo);
    fd.set('reason', reason);
    fd.set('content', content);
    for (const f of files) fd.append('photos', f);
    const r = await submitAs(fd);
    setBusy(false);
    if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '접수하지 못했어요.');
    router.push(`/orders/${orderNo}/as?done=1`);
    router.refresh();
  };
  return (
    <Card>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <fieldset className="ac-field">
        <legend className="ac-label">어떤 문제가 있나요? (필수)</legend>
        <div className="ac-chip-row" role="group">
          {reasons.map((r) => (
            <button key={r.value} type="button" className="ac-chip" aria-pressed={reason === r.value} onClick={() => setReason(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
      </fieldset>
      <Field label="내용" required>
        {(id) => <Textarea id={id} rows={4} maxLength={1000} placeholder="언제부터, 어떤 증상인지 알려 주세요." value={content} onChange={(e) => setContent(e.target.value)} />}
      </Field>
      <Field label="사진 (3장까지)" help="증상이 보이게 찍어 주시면 빨리 확인할 수 있어요.">
        {(id, d) => (
          <input
            id={id}
            aria-describedby={d}
            className="ac-input"
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []).slice(0, 3);
              if (list.reduce((s, f) => s + f.size, 0) > MAX_TOTAL) {
                setError('사진은 합쳐서 3.5MB 이하로 올려 주세요.');
                e.target.value = '';
                return setFiles([]);
              }
              setError(null);
              setFiles(list);
            }}
          />
        )}
      </Field>
      <Button
        variant="primary"
        size="lg"
        block
        loading={busy}
        onClick={() => {
          if (!reason) return setError(MSG.required('AS 사유'));
          if (!content.trim()) return setError(MSG.required('내용'));
          setError(null);
          setConfirm(true);
        }}
      >
        AS 요청하기
      </Button>
      <ConfirmModal open={confirm} message="AS를 요청하시겠습니까?" confirmLabel="요청" onConfirm={send} onCancel={() => setConfirm(false)} />
    </Card>
  );
}
