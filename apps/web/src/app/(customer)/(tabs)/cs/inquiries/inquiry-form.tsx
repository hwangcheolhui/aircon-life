'use client';
// C-CS-020 문의 작성 (F-CUS-CS-02): 유형·내용 필수, 관련 접수번호 선택 입력
import { Alert, Button, Card, Field, Input, MSG, Select, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { submitInquiry } from './actions';

export function InquiryForm({ types, disabled }: { types: { value: string; label: string }[]; disabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const blank = { subType: '', orderNo: '', content: '' };
  const [v, setV] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!v.subType) return setError(MSG.required('문의 유형'));
    if (!v.content.trim()) return setError(MSG.required('문의 내용'));
    setBusy(true);
    const r = await submitInquiry(v);
    setBusy(false);
    if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '보내지 못했어요.');
    setError(null);
    setV(blank);
    toast('문의를 보냈어요. 답변이 오면 알려 드릴게요.');
    router.refresh();
  };
  return (
    <Card>
      <h2 className="ac-h3 cus-card-title">문의하기</h2>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <fieldset className="ac-field" disabled={disabled}>
        <Field label="문의 유형" required>
          {(id) => (
            <Select id={id} value={v.subType} onChange={(e) => setV({ ...v, subType: e.target.value })}>
              <option value="">선택</option>
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="관련 접수번호" help="예약과 관련된 문의면 적어 주세요.">
          {(id, d) => <Input id={id} aria-describedby={d} value={v.orderNo} onChange={(e) => setV({ ...v, orderNo: e.target.value })} />}
        </Field>
        <Field label="문의 내용" required>
          {(id) => <Textarea id={id} rows={4} maxLength={2000} value={v.content} onChange={(e) => setV({ ...v, content: e.target.value })} />}
        </Field>
        <Button variant="primary" size="lg" block loading={busy} onClick={send}>
          보내기
        </Button>
      </fieldset>
    </Card>
  );
}
