'use client';
// A-TEC-050 이탈 처리 폼 (F-ADM-TEC-07)
import { Alert, Button, ConfirmModal, Field, Input, Select, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Option } from '@/admin/crud-screen';
import { markTechLeftAction } from './actions';

export function LeaveForm({ techs, reasons, today }: { techs: Option[]; reasons: Option[]; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState({ technicianId: '', leaveReason: '', leftAt: today });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="ac-search-panel"
      onSubmit={(e) => {
        e.preventDefault();
        setConfirm(true);
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="기사" required error={errors.technicianId}>
        {(id, d, inv) => (
          <Select id={id} aria-describedby={d} aria-invalid={inv} value={v.technicianId} onChange={(e) => setV({ ...v, technicianId: e.target.value })}>
            <option value="">선택</option>
            {techs.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="이탈 사유" required error={errors.leaveReason}>
        {(id, d, inv) => (
          <Select id={id} aria-describedby={d} aria-invalid={inv} value={v.leaveReason} onChange={(e) => setV({ ...v, leaveReason: e.target.value })}>
            <option value="">선택</option>
            {reasons.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="이탈일" required error={errors.leftAt}>
        {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} type="date" max={today} value={v.leftAt} onChange={(e) => setV({ ...v, leftAt: e.target.value })} />}
      </Field>
      <div className="ac-search-panel__actions">
        <Button type="submit" variant="danger" size="sm" loading={busy}>
          이탈 처리
        </Button>
      </div>
      <ConfirmModal
        open={confirm}
        message="이탈 처리하시겠습니까?"
        description="기사 상태가 이탈로 바뀌고 로그인할 수 없습니다."
        confirmLabel="이탈 처리"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          setBusy(true);
          setError(null);
          const r = await markTechLeftAction(v);
          setBusy(false);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return setError(r.message ?? null);
          }
          setErrors({});
          setV({ technicianId: '', leaveReason: '', leftAt: today });
          toast('이탈 처리했습니다.');
          router.refresh();
        }}
      />
    </form>
  );
}
