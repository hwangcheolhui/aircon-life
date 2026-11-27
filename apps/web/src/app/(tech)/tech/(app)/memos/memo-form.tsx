'use client';
// T-MEMO-010 메모 등록·수정 폼 (F-TEC-MEMO-01): 머리말 · 내용(1000자) · 기간 · 반복 · 관련 접수번호
// 반복이면 종료일 = 반복 종료일, 반복 없음은 최대 31일 (01_ERD §2.13.1 memo)
import type { CodeOption } from '@/server/codes';
import { Alert, Button, ConfirmModal, Field, Input, MSG, Select, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteMemoAction, saveMemoAction } from '../support-actions';

export interface MemoFormValues {
  id?: number;
  headerCode: string;
  content: string;
  startDate: string;
  endDate: string;
  repeatType: string;
  relatedOrderNo: string;
}

export function MemoForm({ initial, headers, repeats, backHref }: { initial: MemoFormValues; headers: CodeOption[]; repeats: CodeOption[]; backHref: string }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'save' | 'delete' | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof MemoFormValues) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const repeating = v.repeatType !== 'NONE';

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await saveMemoAction({ ...v, id: v.id ? String(v.id) : '' });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return setError(r.message ?? null);
      }
      toast(MSG.saved);
      router.push(backHref);
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      const r = await deleteMemoAction(v.id!);
      if (!r.ok) return setError(r.message ?? '삭제하지 못했습니다.');
      toast('삭제했습니다.');
      router.push(backHref);
      router.refresh();
    });

  return (
    <form
      className="tec-section"
      onSubmit={(e) => {
        e.preventDefault();
        setConfirm('save');
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="머리말" required error={errors.headerCode}>
        {(id, d, inv) => (
          <Select id={id} aria-describedby={d} aria-invalid={inv} value={v.headerCode} onChange={set('headerCode')}>
            {headers.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="내용" required error={errors.content} help="1000자 이내">
        {(id, d, inv) => <Textarea id={id} aria-describedby={d} aria-invalid={inv} rows={5} maxLength={1000} value={v.content} onChange={set('content')} />}
      </Field>
      <Field label="반복" required error={errors.repeatType}>
        {(id, d, inv) => (
          <Select id={id} aria-describedby={d} aria-invalid={inv} value={v.repeatType} onChange={set('repeatType')}>
            {repeats.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="tec-btn-row">
        <Field label="시작일" required error={errors.startDate}>
          {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} type="date" value={v.startDate} onChange={set('startDate')} />}
        </Field>
        <Field label={repeating ? '반복 종료일' : '종료일'} required error={errors.endDate} help={repeating ? undefined : '최대 31일'}>
          {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} type="date" value={v.endDate} onChange={set('endDate')} />}
        </Field>
      </div>
      <Field label="관련 접수번호" error={errors.relatedOrderNo} help="내 작업만 연결할 수 있어요.">
        {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} value={v.relatedOrderNo} onChange={set('relatedOrderNo')} maxLength={20} inputMode="text" />}
      </Field>
      <div className="tec-actions">
        <Button type="submit" variant="primary" size="lg" block loading={pending}>
          저장
        </Button>
        {v.id ? (
          <Button variant="outline" block onClick={() => setConfirm('delete')}>
            삭제
          </Button>
        ) : null}
      </div>
      <ConfirmModal
        open={confirm === 'save'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          submit();
        }}
      />
      <ConfirmModal
        open={confirm === 'delete'}
        message="메모를 삭제하시겠습니까?"
        confirmLabel="삭제"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          remove();
        }}
      />
    </form>
  );
}
