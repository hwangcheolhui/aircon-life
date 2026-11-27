'use client';
// T-MAT-020 자재 요청 폼·요청 행 (F-TEC-MAT-02)
import { Alert, Button, ConfirmModal, Field, Input, MSG, Select, Tag, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { changeMaterialRequestAction, requestMaterialAction } from '../../support-actions';

const TONE: Record<string, 'primary' | 'success' | 'warning' | 'danger' | undefined> = { REQUESTED: 'primary', SHIPPED: 'warning', RECEIVED: 'success' };

export function MaterialRequestForm({ materials, today }: { materials: { id: number; name: string; unit: string }[]; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const empty = { materialId: '', quantity: '1', neededDate: today, relatedOrderNo: '' };
  const [v, setV] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const unit = materials.find((m) => String(m.id) === v.materialId)?.unit;
  return (
    <form
      className="tec-section"
      onSubmit={(e) => {
        e.preventDefault();
        setConfirm(true);
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="자재" required error={errors.materialId}>
        {(id, d, inv) => (
          <Select id={id} aria-describedby={d} aria-invalid={inv} value={v.materialId} onChange={set('materialId')}>
            <option value="">선택</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="tec-btn-row">
        <Field label={unit ? `수량(${unit})` : '수량'} required error={errors.quantity}>
          {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} type="number" min={1} inputMode="numeric" value={v.quantity} onChange={set('quantity')} />}
        </Field>
        <Field label="필요일" required error={errors.neededDate}>
          {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} type="date" min={today} value={v.neededDate} onChange={set('neededDate')} />}
        </Field>
      </div>
      <Field label="관련 접수번호" error={errors.relatedOrderNo} help="내 작업만 연결할 수 있어요.">
        {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} maxLength={20} value={v.relatedOrderNo} onChange={set('relatedOrderNo')} />}
      </Field>
      <Button type="submit" variant="primary" size="lg" block loading={pending}>
        요청
      </Button>
      <ConfirmModal
        open={confirm}
        message="자재를 요청하시겠습니까?"
        confirmLabel="요청"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          start(async () => {
            setError(null);
            const r = await requestMaterialAction(v);
            if (!r.ok) {
              setErrors(r.fieldErrors ?? {});
              return setError(r.message ?? null);
            }
            setErrors({});
            setV(empty);
            toast(MSG.saved);
            router.refresh();
          });
        }}
      />
    </form>
  );
}

export function MaterialRequestRow({
  row: r,
}: {
  row: { id: number; materialName: string; unit: string; quantity: number; neededDate: string; status: string; statusLabel: string; orderNo: string | null };
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState<'CANCELED' | 'RECEIVED' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const open = r.status === 'REQUESTED' || r.status === 'SHIPPED';
  return (
    <div className={`tec-job-card${open ? '' : ' is-done'}`}>
      <div className="tec-job-card__top">
        <Tag tone={TONE[r.status]}>{r.statusLabel}</Tag>
        <span className="ac-body">{r.materialName}</span>
        <strong className="tec-job-card__time ac-num">
          {r.quantity}
          {r.unit}
        </strong>
      </div>
      <span className="ac-body-sm ac-num">
        필요일 {r.neededDate}
        {r.orderNo ? ` · ${r.orderNo}` : ''}
      </span>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {open ? (
        <div className="tec-btn-row">
          {r.status === 'REQUESTED' ? (
            <Button variant="outline" loading={pending} onClick={() => setConfirm('CANCELED')}>
              요청 취소
            </Button>
          ) : (
            <span />
          )}
          <Button variant="dark" loading={pending} onClick={() => setConfirm('RECEIVED')}>
            수령 확인
          </Button>
        </div>
      ) : null}
      <ConfirmModal
        open={confirm !== null}
        message={confirm === 'CANCELED' ? '요청을 취소하시겠습니까?' : '자재를 받으셨습니까? 보유 수량에 더해집니다.'}
        confirmLabel={confirm === 'CANCELED' ? '요청 취소' : '수령 확인'}
        danger={confirm === 'CANCELED'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const to = confirm!;
          setConfirm(null);
          start(async () => {
            setError(null);
            const res = await changeMaterialRequestAction(r.id, to);
            if (!res.ok) return setError(res.message ?? '처리하지 못했습니다.');
            toast(to === 'CANCELED' ? '요청을 취소했습니다.' : '수령을 확인했습니다.');
            router.refresh();
          });
        }}
      />
    </div>
  );
}
