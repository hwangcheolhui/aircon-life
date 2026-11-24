'use client';
// T-WRK-070 활동내역 (B, 하단 시트) · F-TEC-WRK-09: 유형(통화·문자·방문 시도·메모) + 내용 → 주문 타임라인(activity_log)
import { Alert, Button, Field, Select, Textarea, useToast } from '@aircon/ui';
import { MessageSquarePlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition } from 'react';
import { addJobActivity } from '@/app/(tech)/tech/(flow)/actions';

type Code = { value: string; label: string };

export function ActivitySheetButton({ orderNo, types }: { orderNo: string; types: Code[] }) {
  const router = useRouter();
  const toast = useToast();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('');
  const [content, setContent] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <Button variant="outline" size="lg" block onClick={() => setOpen(true)}>
        <MessageSquarePlus aria-hidden /> 활동내역 등록
      </Button>
      {open ? (
        <div className="ac-overlay tec-sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="ac-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <div className="ac-sheet__handle" aria-hidden />
            <h2 id={titleId} className="ac-h3">
              활동내역 등록
            </h2>
            {message ? <Alert tone="danger">{message}</Alert> : null}
            <Field label="유형" required error={errors.activityType}>
              {(id, d, inv) => (
                <Select id={id} aria-describedby={d} aria-invalid={inv} value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">선택</option>
                  {types.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="내용" required error={errors.content}>
              {(id, d, inv) => (
                <Textarea id={id} aria-describedby={d} aria-invalid={inv} rows={3} maxLength={500} value={content} onChange={(e) => setContent(e.target.value)} />
              )}
            </Field>
            <div className="tec-btn-row">
              <Button variant="secondary" size="lg" onClick={() => setOpen(false)}>
                닫기
              </Button>
              <Button
                variant="primary"
                size="lg"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    setErrors({});
                    setMessage(null);
                    const r = await addJobActivity({ orderNo, activityType: type, content });
                    if (!r.ok) {
                      setErrors(r.fieldErrors ?? {});
                      return setMessage(r.message ?? null);
                    }
                    setOpen(false);
                    setType('');
                    setContent('');
                    toast('저장에 성공하였습니다.');
                    router.refresh();
                  })
                }
              >
                저장
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
