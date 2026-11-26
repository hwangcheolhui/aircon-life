'use client';
// A-CSL-050 일반문의·클레임 탭 (F-ADM-CSL-13). 클레임은 VOC(접수)로 함께 만들어지고 VOC가 완료될 때까지 다음 통화 때 Alert 한다(BR-022, 단계 8).
import { Alert, Button, Check, ConfirmModal, Field, MSG, Select, Textarea, useToast } from '@aircon/ui';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { submitConsult } from './actions';
import type { ConsoleData } from './screen';

type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown };

export function InquiryTab({ data, codes, canWrite, onSaved }: { data: ConsoleData | null; codes: Record<string, Option[]>; canWrite: boolean; onSaved: () => void }) {
  const toast = useToast();
  const blank = { consultType: 'INQUIRY' as 'INQUIRY' | 'CLAIM', subType: '', relatedOrderId: '', content: '', done: true };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!data) return;
    setConfirm(false);
    setBusy(true);
    const r = (await submitConsult({ ...f, customerId: data.customer.id, callLogId: data.callLogId ?? '' })) as Res;
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '저장하지 못했습니다.');
    }
    toast(MSG.saved);
    setF(blank);
    setErrors({});
    setError(null);
    onSaved();
  };

  return (
    <div className="adm-csl-order">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="ac-segmented" role="group" aria-label="상담 유형">
        {(['INQUIRY', 'CLAIM'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={f.consultType === t} onClick={() => setF({ ...f, consultType: t })}>
            {labelOf(codes.CONSULT_TYPE, t)}
          </button>
        ))}
      </div>
      <div className="adm-form-grid">
        <Field label="세부 유형" required error={errors.subType}>
          {(id) => (
            <Select id={id} value={f.subType} onChange={(e) => setF({ ...f, subType: e.target.value })}>
              <option value="">선택</option>
              {codes.INQUIRY_SUB_TYPE?.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="관련 주문">
          {(id) => (
            <Select id={id} value={f.relatedOrderId} onChange={(e) => setF({ ...f, relatedOrderId: e.target.value })}>
              <option value="">없음</option>
              {data?.orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNo}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="adm-span-2">
          <Field label="상담 내용" required error={errors.content}>
            {(id) => <Textarea id={id} rows={4} maxLength={4000} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} />}
          </Field>
        </div>
        {f.consultType === 'INQUIRY' ? (
          <Check label="통화 중 처리 완료" checked={f.done} onChange={(e) => setF({ ...f, done: e.target.checked })} />
        ) : (
          <p className="ac-body-sm adm-span-2">클레임은 VOC로 접수되어 처리를 마칠 때까지 이 고객 상담 시 알림이 뜹니다.</p>
        )}
      </div>
      <div className="adm-toolbar">
        <span />
        <Button
          variant="primary"
          loading={busy}
          disabled={!canWrite || !data}
          onClick={() => {
            const miss: Record<string, string> = {};
            if (!f.subType) miss.subType = MSG.required('세부 유형');
            if (!f.content.trim()) miss.content = MSG.required('상담 내용');
            setErrors(miss);
            if (Object.keys(miss).length === 0) setConfirm(true);
          }}
        >
          저장
        </Button>
      </div>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </div>
  );
}
