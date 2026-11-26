'use client';
// T-NTF-020 회신 입력 (F-TEC-NTF-02): 큰 버튼·본문 16px(기사 채널 밀도는 data-channel=tech)
import { Alert, Button, Card, Field, MSG, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { replyFollowup } from '../../../aftercare-actions';

export function ReplyForm({ id }: { id: number }) {
  const router = useRouter();
  const toast = useToast();
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!reply.trim()) return setError(MSG.required('회신 내용'));
    setBusy(true);
    const r = await replyFollowup({ id, reply });
    setBusy(false);
    if (!r.ok) return setError(r.message ?? '보내지 못했습니다.');
    toast('회신을 보냈습니다.');
    router.refresh();
  };
  return (
    <Card>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="회신" required>
        {(id2) => <Textarea id={id2} rows={4} maxLength={500} placeholder="예: 10분 뒤 도착합니다. 고객님께 연락드렸습니다." value={reply} onChange={(e) => setReply(e.target.value)} />}
      </Field>
      <Button variant="primary" size="lg" block loading={busy} onClick={send}>
        회신 보내기
      </Button>
    </Card>
  );
}
