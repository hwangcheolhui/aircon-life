'use client';
// T-WRK-020 작업 사진 · F-TEC-WRK-03: 기기별 작업 전/후 촬영 슬롯(필수, BR-041), 이상 발견·안전 사진(선택).
// 찍은 사진은 업로드 대기열(photo-queue)에 먼저 저장되고 백그라운드로 올라간다. 필수 사진이 다 올라가야 [다음]이 켜진다(03 §6.2).
import { Alert, Button, Modal, useToast } from '@aircon/ui';
import { Camera, RotateCw, Trash2, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { removeWorkPhoto, uploadWorkPhoto } from '@/app/(tech)/tech/(flow)/actions';
import { type QueuedPhoto, type UploadedPhoto, usePhotoQueue } from './photo-queue';

interface Unit {
  orderItemId: number;
  unitNo: number;
  label: string;
}

const slotKey = (t: string, item: number | null, unit: number | null) => `${t}:${item ?? ''}:${unit ?? ''}`;

function PendingThumb({ p, onDiscard, onRetry }: { p: QueuedPhoto; onDiscard: () => void; onRetry: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(p.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [p.blob]);
  return (
    <div className="ac-photo-slot ac-photo-slot--pending">
      {url ? <img src={url} alt="올리는 중인 사진" /> : null}
      {p.error ? (
        <>
          <span className="ac-photo-slot__state ac-photo-slot__state--error" title={p.error}>
            실패
          </span>
          <Button variant="ghost" className="ac-btn--icon ac-photo-slot__remove" aria-label="다시 올리기" onClick={onRetry}>
            <RotateCw aria-hidden />
          </Button>
          <Button variant="ghost" className="ac-btn--icon" aria-label="사진 버리기" onClick={onDiscard}>
            <Trash2 aria-hidden />
          </Button>
        </>
      ) : (
        <span className="ac-photo-slot__state">{p.tries > 0 ? '재시도 대기' : '올리는 중'}</span>
      )}
    </div>
  );
}

function AddSlot({ label, required, cameraOnly, onPick }: { label: string; required: boolean; cameraOnly: boolean; onPick: (f: File) => void }) {
  return (
    <label className={`ac-photo-slot ac-photo-slot--add${required ? ' ac-photo-slot--required' : ''}`}>
      <Camera aria-hidden />
      <span>{label}</span>
      <input
        type="file"
        accept="image/*"
        {...(cameraOnly ? { capture: 'environment' as const } : {})}
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onPick(f);
        }}
      />
    </label>
  );
}

export function PhotoBoard({
  orderNo,
  units,
  photos: initial,
  cameraOnly,
  editable,
}: {
  orderNo: string;
  units: Unit[];
  photos: UploadedPhoto[];
  cameraOnly: boolean;
  editable: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [photos, setPhotos] = useState(initial);
  const [confirmDelete, setConfirmDelete] = useState<UploadedPhoto | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setPhotos(initial), [initial]);
  const q = usePhotoQueue(orderNo, uploadWorkPhoto, (p) => {
    setPhotos((cur) => (cur.some((x) => x.id === p.id) ? cur : [...cur, p]));
    router.refresh();
  });

  const bySlot = useMemo(() => {
    const m = new Map<string, { done: UploadedPhoto[]; queued: QueuedPhoto[] }>();
    const get = (k: string) => m.get(k) ?? (m.set(k, { done: [], queued: [] }), m.get(k)!);
    for (const p of photos) get(slotKey(p.photoType, p.orderItemId, p.unitNo)).done.push(p);
    for (const p of q.items) get(slotKey(p.photoType, p.orderItemId, p.unitNo)).queued.push(p);
    return m;
  }, [photos, q.items]);

  const missing = units.flatMap((u) =>
    ['BEFORE', 'AFTER'].filter((t) => !(bySlot.get(slotKey(t, u.orderItemId, u.unitNo))?.done.length ?? 0)).map((t) => `${u.label} ${t === 'BEFORE' ? '작업 전' : '작업 후'}`),
  );
  const waiting = q.items.filter((p) => !p.error).length;

  const slot = (title: string, type: string, item: number | null, unit: number | null, required: boolean) => {
    const s = bySlot.get(slotKey(type, item, unit)) ?? { done: [], queued: [] };
    return (
      <div className="tec-photo-group">
        <h3 className="ac-body-sm tec-photo-group__title">
          {title} {required ? <span className="ac-caption">(필수)</span> : null}
        </h3>
        <div className="ac-photo-grid">
          {s.done.map((p) => (
            <div key={p.id} className="ac-photo-slot">
              <img src={p.url} alt={`${title} 사진`} />
              {editable ? (
                <Button variant="ghost" className="ac-btn--icon ac-photo-slot__remove" aria-label={`${title} 사진 지우기`} onClick={() => setConfirmDelete(p)}>
                  <Trash2 aria-hidden />
                </Button>
              ) : null}
            </div>
          ))}
          {s.queued.map((p) => (
            <PendingThumb key={p.id} p={p} onDiscard={() => void q.discard(p.id)} onRetry={() => void q.retry(p.id)} />
          ))}
          {editable ? (
            <AddSlot
              label={`${title} 촬영`}
              required={required && s.done.length + s.queued.length === 0}
              cameraOnly={cameraOnly}
              onPick={(f) => void q.add(f, { photoType: type, orderItemId: item, unitNo: unit })}
            />
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="tec-photo-status" role="status">
        {!q.online ? (
          <span className="ac-offline">
            <WifiOff aria-hidden /> 오프라인 · 연결되면 자동으로 올립니다
          </span>
        ) : null}
        {waiting ? <span className="ac-caption ac-num">업로드 대기 {waiting}장</span> : null}
      </div>
      {units.map((u) => (
        <section key={`${u.orderItemId}:${u.unitNo}`} className="tec-section" aria-label={u.label}>
          <h2 className="ac-h3">{u.label}</h2>
          {slot(`${u.label} 작업 전`, 'BEFORE', u.orderItemId, u.unitNo, true)}
          {slot(`${u.label} 작업 후`, 'AFTER', u.orderItemId, u.unitNo, true)}
        </section>
      ))}
      <section className="tec-section" aria-label="추가 사진">
        <h2 className="ac-h3">추가 사진 (선택)</h2>
        {slot('이상 발견', 'ISSUE', null, null, false)}
        {slot('안전관리', 'SAFETY', null, null, false)}
      </section>
      {missing.length ? (
        <Alert tone="warning">필수 사진 {missing.length}장이 남았습니다: {missing.join(', ')}</Alert>
      ) : null}
      <div className="tec-actions">
        {missing.length === 0 && waiting === 0 ? (
          <Link href={`/tech/jobs/${orderNo}/work/result`} className="ac-btn ac-btn--primary ac-btn--lg ac-btn--block">
            다음: 처리 결과
          </Link>
        ) : (
          <Button variant="primary" size="lg" block disabled>
            다음: 처리 결과
          </Button>
        )}
        <Link href={`/tech/jobs/${orderNo}/work/result`} className="ac-btn ac-btn--text ac-btn--block">
          작업하지 못한 기기가 있으면 결과부터 입력
        </Link>
      </div>
      <Modal
        open={confirmDelete !== null}
        title="사진을 지울까요?"
        onClose={() => setConfirmDelete(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              닫기
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const p = confirmDelete!;
                  const r = await removeWorkPhoto({ orderNo, photoId: p.id });
                  setConfirmDelete(null);
                  if (!r.ok) return toast(r.message ?? '지우지 못했습니다.');
                  setPhotos((cur) => cur.filter((x) => x.id !== p.id));
                  router.refresh();
                })
              }
            >
              지우기
            </Button>
          </>
        }
      />
    </>
  );
}
