'use client';
// C-MY-040 탈퇴 입력
import { Alert, Button, Check, ConfirmModal, Field, Textarea } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { withdraw } from '../actions';

export function WithdrawForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="cus-section">
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <Field label="탈퇴 사유">
        {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Check label="유의사항을 확인했어요" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
      <Button variant="danger" size="lg" block disabled={!agreed || demo} loading={pending} onClick={() => setConfirm(true)}>
        탈퇴하기
      </Button>
      <ConfirmModal
        open={confirm}
        message="정말 탈퇴하시겠습니까?"
        confirmLabel="탈퇴"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          start(async () => {
            setConfirm(false);
            const r = await withdraw({ reason, agreed });
            if (!r.ok) return setMessage(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '탈퇴하지 못했습니다.');
            router.replace('/');
            router.refresh();
          })
        }
      />
    </div>
  );
}
