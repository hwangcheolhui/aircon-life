'use client';
// C-REV-010 후기 입력 (F-CUS-REV-01): 별점 필수, 추천의향 0~10 선택, 태그·사진(3장, 합계 3.5MB)·내용 선택
import { Alert, Button, Card, ConfirmModal, Field, MSG, Textarea } from '@aircon/ui';
import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { sendReview } from '../../actions';

const MAX_TOTAL = 3.5 * 1024 * 1024;

export function ReviewForm({ orderNo, tags }: { orderNo: string; tags: { value: string; label: string }[] }) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [nps, setNps] = useState<number | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
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
    fd.set('rating', String(rating));
    if (nps !== null) fd.set('npsScore', String(nps));
    for (const t of picked) fd.append('tags', t);
    fd.set('content', content);
    for (const f of files) fd.append('photos', f);
    const r = await sendReview(fd);
    setBusy(false);
    if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '후기를 남기지 못했어요.');
    router.push(`/orders/${orderNo}/review?done=1`);
    router.refresh();
  };
  return (
    <Card>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <fieldset className="ac-field">
        <legend className="ac-label">작업은 만족스러우셨나요? (필수)</legend>
        <div className="cus-stars" role="group" aria-label="별점">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className="ac-btn ac-btn--ghost ac-btn--icon" aria-pressed={rating >= n} aria-label={`${n}점`} onClick={() => setRating(n)}>
              <Star aria-hidden fill={rating >= n ? 'currentColor' : 'none'} />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="ac-field">
        <legend className="ac-label">가족·지인에게 추천할 의향은요? (0~10)</legend>
        <div className="cus-nps" role="group" aria-label="추천 의향">
          {Array.from({ length: 11 }, (_, n) => (
            <button key={n} type="button" className="ac-chip ac-num" aria-pressed={nps === n} onClick={() => setNps(nps === n ? null : n)}>
              {n}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="ac-field">
        <legend className="ac-label">좋았던 점·아쉬운 점</legend>
        <div className="ac-chip-row" role="group">
          {tags.map((t) => (
            <button
              key={t.value}
              type="button"
              className="ac-chip"
              aria-pressed={picked.includes(t.value)}
              onClick={() => setPicked((p) => (p.includes(t.value) ? p.filter((x) => x !== t.value) : [...p, t.value]))}
            >
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>
      <Field label="내용">{(id) => <Textarea id={id} rows={4} maxLength={1000} value={content} onChange={(e) => setContent(e.target.value)} />}</Field>
      <Field label="사진 (3장까지)">
        {(id) => (
          <input
            id={id}
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
          if (!rating) return setError(MSG.required('별점'));
          setError(null);
          setConfirm(true);
        }}
      >
        후기 남기기
      </Button>
      <ConfirmModal open={confirm} message="후기를 등록하시겠습니까?" confirmLabel="등록" onConfirm={send} onCancel={() => setConfirm(false)} />
    </Card>
  );
}
