'use client';
// A-DSP-060 기사 관할 구역 지정 · F-ADM-DSP-08
// 좌: 기사 목록 + 선택한 기사의 구역 · 우: 지도(구역·법정동 점, 주 관할 빈 곳/겹침 표시) + 구역 편집.
// 지정 방식: [법정동 선택] 지도의 동 점을 눌러 묶음 · [직접 그리기] 지도를 눌러 꼭짓점 추가.
import type { LatLng, Position } from '@aircon/domain';
import { Alert, Button, ConfirmModal, Empty, Field, Input, MSG, Select, Tag, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { type CSSProperties, useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import type { ZoneBoard } from '@/server/zones';
import { GeoMap, MapLegend, type MapDong, type MapShape } from '@/shared/geo-map';
import { remove, save } from './actions';

type Zone = ZoneBoard['zones'][number];
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

const PALETTE = ['1', '2', '3', '4', '5', '6'] as const;

interface Draft {
  id: number | null;
  technicianId: number;
  zoneName: string;
  zoneType: 'PRIMARY' | 'SECONDARY';
  defineMethod: 'DONG_SET' | 'DRAWN';
  dongCodes: string[];
  points: Position[];
  color: string;
  validFrom: string;
  validTo: string;
}

const errOf = (r: Res) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '저장하지 못했습니다.';

export function ZonesScreen(p: {
  branches: Option[];
  branchId: string;
  techId: string;
  board: ZoneBoard | null;
  codes: Record<string, Option[]>;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const L = (g: string, v: string | null | undefined) => labelOf(p.codes[g], v);
  const b = p.board;
  const [techId, setTechId] = useState<number | null>(() => {
    const n = Number(p.techId);
    return b?.techs.some((t) => t.id === n) ? n : (b?.techs[0]?.id ?? null);
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'save' | Zone>(null);

  const zonesOf = (id: number | null) => (b?.zones ?? []).filter((z) => z.technicianId === id);
  const myZones = zonesOf(techId);
  const techName = (id: number) => b?.techs.find((t) => t.id === id)?.name ?? '';
  const gaps = new Set(b?.coverage.gaps ?? []);
  const overlaps = b?.coverage.overlaps ?? {};

  const go = (branchId: string) => router.push(`/admin/dsp/zones?branchId=${branchId}`);

  const startNew = () => {
    if (techId === null) return;
    const used = new Set(myZones.map((z) => z.color));
    setDraft({
      id: null,
      technicianId: techId,
      zoneName: '',
      zoneType: myZones.some((z) => z.zoneType === 'PRIMARY') ? 'SECONDARY' : 'PRIMARY',
      defineMethod: 'DONG_SET',
      dongCodes: [],
      points: [],
      color: PALETTE.find((c) => !used.has(c)) ?? '1',
      validFrom: '',
      validTo: '',
    });
    setError(null);
  };
  const startEdit = (z: Zone) => {
    const ring =
      z.defineMethod === 'DRAWN' && z.boundary?.type === 'Polygon'
        ? z.boundary.coordinates[0]!.slice(0, -1)
        : [];
    setDraft({
      id: z.id,
      technicianId: z.technicianId,
      zoneName: z.zoneName,
      zoneType: z.zoneType as Draft['zoneType'],
      defineMethod: z.defineMethod as Draft['defineMethod'],
      dongCodes: z.dongCodes,
      points: ring,
      color: z.color,
      validFrom: z.validFrom ?? '',
      validTo: z.validTo ?? '',
    });
    setError(null);
  };
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setError(null);
  };

  const shapes: MapShape[] = (b?.zones ?? [])
    .filter((z) => z.boundary && z.activeToday && z.id !== draft?.id)
    .map((z) => ({
      id: String(z.id),
      shape: z.boundary!,
      palette: z.technicianId === (draft?.technicianId ?? techId) ? z.color : 'muted',
      secondary: z.zoneType === 'SECONDARY',
      title: `${techName(z.technicianId)} · ${z.zoneName} (${L('ZONE_TYPE', z.zoneType)})`,
    }));

  const dongs: MapDong[] = (b?.dongs ?? []).map((d) => ({
    code: d.code,
    label: d.label,
    center: d.center,
    state: gaps.has(d.code) ? 'gap' : overlaps[d.code] ? 'overlap' : null,
    pressed: draft?.defineMethod === 'DONG_SET' ? draft.dongCodes.includes(d.code) : undefined,
    onToggle:
      draft?.defineMethod === 'DONG_SET'
        ? () =>
            set({
              dongCodes: draft.dongCodes.includes(d.code)
                ? draft.dongCodes.filter((c) => c !== d.code)
                : [...draft.dongCodes, d.code],
            })
        : undefined,
  }));

  const onMapClick =
    draft?.defineMethod === 'DRAWN'
      ? (pt: LatLng) =>
          set({ points: [...draft.points, [Number(pt.lng.toFixed(6)), Number(pt.lat.toFixed(6))]] })
      : undefined;

  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    const r = (await save({ ...draft })) as Res;
    setBusy(false);
    if (!r.ok) return setError(errOf(r));
    setDraft(null);
    toast(MSG.saved);
    router.refresh();
  };
  const del = async (z: Zone) => {
    setBusy(true);
    const r = (await remove({ id: z.id })) as Res;
    setBusy(false);
    if (!r.ok) return setError(errOf(r));
    if (draft?.id === z.id) setDraft(null);
    toast('삭제되었습니다.');
    router.refresh();
  };

  return (
    <>
      <div className="adm-page-head">
        <h1 className="ac-h1">기사 관할 구역 지정</h1>
        <div className="adm-actions">
          <Select aria-label="거점" value={p.branchId} onChange={(e) => go(e.target.value)}>
            {p.branches.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {!b ? (
        <Empty />
      ) : (
        <>
          <div className="adm-board-summary" aria-live="polite">
            <Tag tone={b.coverage.gaps.length ? 'warning' : 'success'}>
              주 관할 없는 동 <span className="ac-num">{b.coverage.gaps.length}</span>
            </Tag>
            <Tag tone={Object.keys(overlaps).length ? 'warning' : 'success'}>
              주 관할 겹침 <span className="ac-num">{Object.keys(overlaps).length}</span>
            </Tag>
            <Tag>
              서비스 지역 <span className="ac-num">{b.dongs.length}</span>
            </Tag>
          </div>
          <div className="adm-zones">
            <div className="adm-zones__side">
              <h2 className="ac-h3">기사</h2>
              {b.techs.length ? (
                <ul className="adm-zones__techs">
                  {b.techs.map((t) => {
                    const zs = zonesOf(t.id);
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          className="adm-zones__tech"
                          aria-pressed={t.id === techId}
                          onClick={() => {
                            setTechId(t.id);
                            setDraft(null);
                          }}
                        >
                          <span>{t.name}</span>
                          <span className="ac-caption">
                            {L('TECH_GRADE', t.grade)} · 구역 <span className="ac-num">{zs.length}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty />
              )}
              {techId !== null ? (
                <>
                  <div className="adm-toolbar">
                    <h2 className="ac-h3">{techName(techId)} 구역</h2>
                    {p.canUpdate ? (
                      <Button size="sm" variant="outline" onClick={startNew} disabled={Boolean(draft)}>
                        구역 추가
                      </Button>
                    ) : null}
                  </div>
                  {myZones.length ? (
                    <ul className="adm-zones__list">
                      {myZones.map((z) => (
                        <li key={z.id} className="ac-card adm-zones__item">
                          <div className="adm-detail-head">
                            <span
                              className="ac-map-legend__swatch"
                              style={{ '--swatch': `var(--map-zone-${z.color})` } as CSSProperties}
                              aria-hidden
                            />
                            <strong>{z.zoneName}</strong>
                            <Tag tone={z.zoneType === 'PRIMARY' ? 'primary' : undefined}>
                              {L('ZONE_TYPE', z.zoneType)}
                            </Tag>
                            {!z.activeToday ? <Tag>적용 기간 아님</Tag> : null}
                          </div>
                          <p className="ac-caption">
                            {L('ZONE_DEFINE_METHOD', z.defineMethod)} · 법정동{' '}
                            <span className="ac-num">{z.dongCodes.length}</span>
                            {z.validFrom || z.validTo ? (
                              <>
                                {' '}
                                · <span className="ac-num">{z.validFrom ?? ''}</span>~
                                <span className="ac-num">{z.validTo ?? ''}</span>
                              </>
                            ) : null}
                          </p>
                          <div className="adm-actions">
                            {p.canUpdate ? (
                              <Button
                                size="sm"
                                variant="text"
                                onClick={() => startEdit(z)}
                                disabled={Boolean(draft)}
                              >
                                수정
                              </Button>
                            ) : null}
                            {p.canDelete ? (
                              <Button size="sm" variant="text" onClick={() => setConfirm(z)} disabled={busy}>
                                삭제
                              </Button>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ac-caption">
                      구역을 지정하지 않은 기사는 기사 상세의 활동지역을 그대로 씁니다.
                    </p>
                  )}
                </>
              ) : null}
            </div>

            <div className="adm-zones__main">
              <GeoMap
                ariaLabel={`${p.branches.find((o) => o.value === p.branchId)?.label ?? ''} 관할 구역 지도`}
                aspect="16 / 10"
                shapes={shapes}
                dongs={dongs}
                draft={draft?.defineMethod === 'DRAWN' ? draft.points : undefined}
                onMapClick={onMapClick}
              />
              <MapLegend
                items={[
                  {
                    label: '선택한 기사 구역',
                    color: `var(--map-zone-${draft?.color ?? myZones[0]?.color ?? '1'})`,
                  },
                  { label: '다른 기사 구역', color: 'var(--map-muted)' },
                  { label: '주 관할 없음', color: 'var(--map-gap)' },
                  { label: '주 관할 겹침', color: 'var(--map-overlap)' },
                ]}
              />
              {Object.keys(overlaps).length ? (
                <p className="ac-caption">
                  겹치는 동:{' '}
                  {Object.entries(overlaps)
                    .map(
                      ([code, ids]) =>
                        `${
                          b.dongs
                            .find((d) => d.code === code)
                            ?.label.split(' ')
                            .pop() ?? code
                        }(${ids.map(techName).join('·')})`,
                    )
                    .join(', ')}
                </p>
              ) : null}

              {draft ? (
                <section className="ac-card adm-gap-top" aria-labelledby="zone-form-title">
                  <h2 id="zone-form-title" className="ac-h3">
                    {draft.id ? '구역 수정' : '구역 추가'} · {techName(draft.technicianId)}
                  </h2>
                  <div className="adm-form-grid adm-gap-top">
                    <Field label="구역명" required>
                      {(id, desc, inv) => (
                        <Input
                          id={id}
                          aria-describedby={desc}
                          aria-invalid={inv}
                          value={draft.zoneName}
                          maxLength={50}
                          onChange={(e) => set({ zoneName: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field
                      label="구역 구분"
                      required
                      help="주 관할: 우선 배정·자가 배정 바로 확정 · 보조: 자가 배정 시 승인 필요(BR-111)"
                    >
                      {(id, desc) => (
                        <Select
                          id={id}
                          aria-describedby={desc}
                          value={draft.zoneType}
                          onChange={(e) => set({ zoneType: e.target.value as Draft['zoneType'] })}
                        >
                          {(p.codes.ZONE_TYPE ?? []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field
                      label="지정 방식"
                      required
                      help={
                        draft.defineMethod === 'DONG_SET'
                          ? '지도에서 법정동 점을 눌러 고릅니다.'
                          : '지도를 눌러 꼭짓점을 차례로 찍습니다(3개 이상).'
                      }
                    >
                      {(id, desc) => (
                        <Select
                          id={id}
                          aria-describedby={desc}
                          value={draft.defineMethod}
                          onChange={(e) => set({ defineMethod: e.target.value as Draft['defineMethod'] })}
                        >
                          {(p.codes.ZONE_DEFINE_METHOD ?? []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="표시 색">
                      {(id, desc) => (
                        <Select
                          id={id}
                          aria-describedby={desc}
                          value={draft.color}
                          onChange={(e) => set({ color: e.target.value })}
                        >
                          {PALETTE.map((c) => (
                            <option key={c} value={c}>
                              색 {c}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="적용 시작일" help="비우면 바로 적용">
                      {(id, desc) => (
                        <Input
                          id={id}
                          aria-describedby={desc}
                          type="date"
                          value={draft.validFrom}
                          onChange={(e) => set({ validFrom: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label="적용 종료일" help="비우면 계속 적용">
                      {(id, desc) => (
                        <Input
                          id={id}
                          aria-describedby={desc}
                          type="date"
                          value={draft.validTo}
                          onChange={(e) => set({ validTo: e.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                  <p className="ac-caption adm-gap-top">
                    {draft.defineMethod === 'DONG_SET' ? (
                      <>
                        고른 법정동 <span className="ac-num">{draft.dongCodes.length}</span>개
                      </>
                    ) : (
                      <>
                        찍은 꼭짓점 <span className="ac-num">{draft.points.length}</span>개 · 꼭짓점 안에
                        중심이 들어오는 법정동이 관할이 됩니다.
                      </>
                    )}
                  </p>
                  {error ? <Alert tone="danger">{error}</Alert> : null}
                  <div className="adm-actions adm-gap-top">
                    {draft.defineMethod === 'DRAWN' ? (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => set({ points: draft.points.slice(0, -1) })}
                          disabled={!draft.points.length}
                        >
                          마지막 점 지우기
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => set({ points: [] })}
                          disabled={!draft.points.length}
                        >
                          다시 그리기
                        </Button>
                      </>
                    ) : null}
                    <Button variant="outline" onClick={() => setDraft(null)}>
                      취소
                    </Button>
                    <Button
                      variant="primary"
                      loading={busy}
                      onClick={() => {
                        if (!draft.zoneName.trim()) return setError(MSG.required('구역명'));
                        setConfirm('save');
                      }}
                    >
                      저장
                    </Button>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </>
      )}
      <ConfirmModal
        open={confirm !== null}
        message={confirm === 'save' ? MSG.confirmSave : '관할 구역을 삭제하시겠습니까?'}
        description={
          confirm === 'save'
            ? '저장하면 이 기사의 활동지역(미배정 작업 노출 범위)이 구역 기준으로 바뀝니다.'
            : '삭제하면 이 구역의 법정동이 기사 활동지역에서 빠집니다.'
        }
        confirmLabel={confirm === 'save' ? '저장' : '삭제'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c === 'save') void submit();
          else if (c) void del(c);
        }}
      />
    </>
  );
}
