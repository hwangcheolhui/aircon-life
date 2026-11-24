'use client';
// T-WRK-061 미처리 저장 · F-TEC-WRK-08: 미처리 사유(필수, BR-031) · 메모(기타는 필수) · 재약속 희망일 → 작업·주문 PENDING
import { Alert, Button, ConfirmModal, Field, Input, Select, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { savePendingJob } from '@/app/(tech)/tech/(flow)/actions';

type Code = { value: string; label: string };

export function PendingForm({ orderNo, reasons, today, absentStreak }: { orderNo: string; reasons: Code[]; today: string; absentStreak: number }) {
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [memo, setMemo] = useState('');
  const [date, setDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      {message ? <Alert tone="danger">{message}</Alert> : null}
      {code === 'CUSTOMER_ABSENT' && absentStreak >= 1 ? (
        <Alert tone="warning">이번이 고객부재 2회째입니다. 저장하면 운영자 확인 후에만 다시 약속할 수 있습니다.</Alert>
      ) : null}
      <Field label="미처리 사유" required error={errors.pendingCode}>
        {(id, d, inv) => (
          <Select id={id} aria-describedby={d} aria-invalid={inv} value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">선택</option>
            {reasons.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="메모" required={code === 'ETC'} error={errors.memo} help="운영자가 처리할 때 봅니다.">
        {(id, d, inv) => <Textarea id={id} aria-describedby={d} aria-invalid={inv} rows={3} maxLength={400} value={memo} onChange={(e) => setMemo(e.target.value)} />}
      </Field>
      <Field label="재약속 희망일" error={errors.revisitDate}>
        {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
      <p className="ac-caption">고객부재로 저장하면 고객에게 "방문했으나 부재" 안내가 갑니다. 응답 전 추가요금은 철회됩니다.</p>
      <Button variant="primary" size="lg" block loading={busy} onClick={() => setConfirm(true)}>
        미처리 저장
      </Button>
      <ConfirmModal
        open={confirm}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          setBusy(true);
          setErrors({});
          setMessage(null);
          const r = await savePendingJob({ orderNo, pendingCode: code, memo, revisitDate: date });
          setBusy(false);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return setMessage(r.message ?? null);
          }
          const d = r.data as { operatorConfirm: boolean };
          toast(d.operatorConfirm ? '저장에 성공하였습니다. 고객부재 2회 연속이라 운영자 확인이 필요합니다.' : '저장에 성공하였습니다.');
          router.push(`/tech/jobs/${orderNo}`);
        }}
      />
    </>
  );
}
