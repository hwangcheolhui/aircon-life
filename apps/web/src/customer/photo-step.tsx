'use client';
// C-QUO-021 사진으로 기기 인식 · F-CUS-QUO-05 (단계 9). 인식 결과는 참고값이라 고객이 형태를 확인·수정한 뒤 대수 단계로 넘어간다
import { Alert, Button, Card, Field, Select, Tag } from '@aircon/ui';
import { Camera } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { confirmPhotos, recognizePhotos } from '@/app/(customer)/quote/actions';
import { QuoteBottomBar, StepHeader, useQuoteDraft } from './quote-flow';

type Option = { value: string; label: string };
type Recognized = { imageId: number; deviceType: string | null; brand: string | null; dirtLevel: string | null; confidence: number; confident: boolean };

const MAX_FILES = 5;

export function PhotoStep({ deviceTypes, dirtLevels, brands }: { deviceTypes: Option[]; dirtLevels: Option[]; brands: Option[] }) {
  const router = useRouter();
  const { draft, ready, update } = useQuoteDraft();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [results, setResults] = useState<Recognized[] | null>(null);
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (ready && !draft.address) router.replace('/quote');
  }, [ready, draft.address, router]);
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  const dong = draft.address?.legalDongCode ?? '';
  const label = (list: Option[], v: string | null) => list.find((o) => o.value === v)?.label ?? v ?? '-';

  const recognize = async () => {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    for (const f of files) fd.append('photos', f);
    const r = await recognizePhotos(fd);
    setBusy(false);
    if (!r.ok) return setError(r.message ?? '사진을 확인하지 못했어요.');
    const list = r.data ?? [];
    setResults(list);
    setChosen(Object.fromEntries(list.map((x) => [x.imageId, deviceTypes.some((t) => t.value === x.deviceType) ? x.deviceType! : ''])));
  };

  const confirm = async () => {
    if (!results) return;
    const items = results.map((x) => ({ imageId: x.imageId, deviceType: chosen[x.imageId] ?? '' }));
    if (items.some((i) => !i.deviceType)) return setError('사진마다 에어컨 형태를 골라 주세요.');
    setBusy(true);
    const r = await confirmPhotos({ items });
    setBusy(false);
    if (!r.ok) return setError(r.message ?? '저장하지 못했어요.');
    // 형태별 대수를 견적 입력으로 (작업 범위는 다음 단계에서 고른다)
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.deviceType] = (counts[i.deviceType] ?? 0) + 1;
    const lines = { ...draft.lines };
    for (const [t, n] of Object.entries(counts)) lines[t] = { quantity: n, cleanLevel: lines[t]?.cleanLevel ?? '' };
    update({ deviceTypes: [...new Set([...draft.deviceTypes, ...Object.keys(counts)])], lines, imageIds: items.map((i) => i.imageId) });
    router.push(`/quote/count?dong=${encodeURIComponent(dong)}`);
  };

  return (
    <>
      <main className="cus-flow__body">
        <StepHeader step={2} backHref={`/quote/device?dong=${encodeURIComponent(dong)}`} title="사진으로 알아볼게요" />
        <p className="ac-body ac-caption">에어컨 전체가 보이게 찍어 주세요. 한 장에 한 대씩, {MAX_FILES}장까지 올릴 수 있어요.</p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {!results ? (
          <Card>
            <Field label="에어컨 사진" help="사진은 견적 확인에만 쓰고 다른 사람에게 보이지 않아요.">
              {(id, d) => (
                <input
                  id={id}
                  aria-describedby={d}
                  className="ac-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    if (list.length > MAX_FILES) setError(`사진은 ${MAX_FILES}장까지 올릴 수 있어요.`);
                    else setError(null);
                    setFiles(list.slice(0, MAX_FILES));
                  }}
                />
              )}
            </Field>
            {previews.length ? (
              <div className="cus-photo-grid">
                {previews.map((u, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={u} src={u} alt={`올린 사진 ${i + 1}`} className="cus-photo-thumb" />
                ))}
              </div>
            ) : null}
          </Card>
        ) : (
          <ul className="ac-stack cus-plain-list" aria-label="인식 결과">
            {results.map((x, i) => (
              <li key={x.imageId}>
                <Card>
                  <div className="ac-row">
                    {previews[i] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previews[i]} alt={`사진 ${i + 1}`} className="cus-photo-thumb" />
                    ) : (
                      <Camera aria-hidden />
                    )}
                    <div>
                      <p className="ac-body">
                        {label(deviceTypes, x.deviceType)} {x.confident ? <Tag tone="success">확실해요</Tag> : <Tag tone="warning">확인해 주세요</Tag>}
                      </p>
                      <p className="ac-caption">
                        제조사 {label(brands, x.brand)} · 오염도 {label(dirtLevels, x.dirtLevel)}
                      </p>
                    </div>
                  </div>
                  <Field label="에어컨 형태" required>
                    {(id) => (
                      <Select id={id} value={chosen[x.imageId] ?? ''} onChange={(e) => setChosen((c) => ({ ...c, [x.imageId]: e.target.value }))}>
                        <option value="">선택</option>
                        {deviceTypes.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
      <QuoteBottomBar label="예상 금액" amount={null}>
        {results ? (
          <Button variant="primary" size="lg" loading={busy} onClick={confirm}>
            이대로 견적 받기
          </Button>
        ) : (
          <Button variant="primary" size="lg" loading={busy} disabled={files.length === 0} onClick={recognize}>
            사진 확인하기
          </Button>
        )}
      </QuoteBottomBar>
    </>
  );
}
