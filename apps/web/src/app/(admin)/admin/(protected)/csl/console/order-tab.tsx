'use client';
/**
 * A-CSL-020 출장접수 탭 · A-CSL-021 Time Table · A-CSL-022 출장 가능 기사 · A-CSL-023 휴일 근무 기사 · A-CSL-024 이중접수 리스트
 * (F-ADM-CSL-05~10). 금액은 서버의 공용 견적 모듈 결과만 보여 준다(화면에서 계산하지 않음).
 */
import { Alert, Button, Check, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, StatusBadge, Textarea, useToast } from '@aircon/ui';
import { useCallback, useEffect, useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import { type TechAvailability, type TimeTableRow, shiftDate } from '@aircon/domain';
import { loadAvailableTechs, loadOnCallTechs, loadTimeTableAction, previewOrder, submitOrder } from './actions';
import type { ConsoleData } from './screen';

type Codes = Record<string, Option[]>;
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown };
const errOf = (r: Res) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '처리하지 못했습니다.';
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export interface Choices {
  products: { id: number; deviceType: string; cleanLevel: string; name: string }[];
  options: { id: number; productId: number | null; name: string; price: number }[];
}
type Line = { deviceType: string; cleanLevel: string; quantity: string };
export interface Preview {
  branchId: number;
  totalAmount: number;
  surchargeAmount: number;
  discountAmount: number;
  durationMin: number;
  needHours: number;
  items: { name: string; itemType: string; quantity: number; amount: number }[];
  visitType: string;
  surchargeNotice: string | null;
}

/* ---------- 출장접수 입력값 (② 탭과 ④ Time Table 이 함께 쓴다) ---------- */

export function useOrderDraft(choices: Choices) {
  const devices = [...new Set(choices.products.map((p) => p.deviceType))];
  const blank = () => ({
    addressId: '',
    lines: [{ deviceType: devices[0] ?? '', cleanLevel: '', quantity: '1' }] as Line[],
    opts: {} as Record<string, string>,
    symptom: '',
    brand: '',
    modelName: '',
    orderType: 'NORMAL',
    customerRequest: '',
    twoPerson: false,
    frequent: false,
    requestedDate: '',
    requestedTime: '',
    slot: null as { date: string; hour: number } | null,
    tech: null as { id: number; name: string } | null,
    internalNote: '',
  });
  const [draft, setDraft] = useState(blank);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const levelsOf = useCallback((dt: string) => choices.products.filter((p) => p.deviceType === dt).map((p) => p.cleanLevel), [choices.products]);
  const quoteLines = () => draft.lines.map((l) => ({ ...l, cleanLevel: l.cleanLevel || levelsOf(l.deviceType)[0] || '' }));
  const quoteOptions = () =>
    Object.entries(draft.opts)
      .filter(([, q]) => Number(q) > 0)
      .map(([optionId, quantity]) => ({ optionId, quantity }));
  return { draft, setDraft, preview, setPreview, errors, setErrors, devices, levelsOf, quoteLines, quoteOptions, reset: () => (setDraft(blank()), setPreview(null), setErrors({})) };
}
export type OrderDraft = ReturnType<typeof useOrderDraft>;

/* ---------- ② 출장접수 탭 (A-CSL-020) ---------- */

export function OrderForm({ d, data, codes, choices, onBranch }: { d: OrderDraft; data: ConsoleData | null; codes: Codes; choices: Choices; onBranch: (id: number) => void }) {
  const { draft, setDraft, preview, setPreview, errors } = d;
  const set = (patch: Partial<typeof draft>) => setDraft((x) => ({ ...x, ...patch }));
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const addresses = data?.addresses ?? [];

  // 기본 주소 자동 선택
  useEffect(() => {
    if (!data) return;
    const a = data.addresses.find((x) => x.isDefault) ?? data.addresses[0];
    setDraft((x) => (x.addressId ? x : { ...x, addressId: a ? String(a.id) : '' }));
  }, [data, setDraft]);
  useEffect(() => {
    const a = addresses.find((x) => String(x.id) === draft.addressId);
    if (a?.branchId) onBranch(a.branchId);
  }, [draft.addressId, addresses, onBranch]);

  // 자동 견적: 주소·기기·대수·옵션·약속일시가 바뀌면 서버 공용 견적 모듈로 다시 계산
  const key = JSON.stringify([draft.addressId, draft.lines, draft.opts, draft.slot, data?.customer.id]);
  useEffect(() => {
    if (!data || !draft.addressId) return setPreview(null);
    const t = setTimeout(async () => {
      const r = (await previewOrder({
        customerId: data.customer.id,
        addressId: draft.addressId,
        lines: d.quoteLines(),
        options: d.quoteOptions(),
        slotDate: draft.slot?.date ?? null,
        slotHour: draft.slot?.hour ?? null,
      })) as Res;
      if (!r.ok) {
        setPreview(null);
        return setQuoteError(errOf(r));
      }
      setQuoteError(null);
      setPreview(r.data as Preview);
    }, 300);
    return () => clearTimeout(t);
  }, [key]);

  const setLine = (i: number, patch: Partial<Line>) => set({ lines: draft.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="adm-csl-order">
      <div className="adm-form-grid adm-csl-grid-3">
        <div className="adm-span-2">
          <Field label="방문 주소" required error={errors.addressId}>
            {(id) => (
              <Select id={id} value={draft.addressId} onChange={(e) => set({ addressId: e.target.value, slot: null, tech: null })}>
                <option value="">선택</option>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.roadAddress}
                    {a.branchName ? ` · ${a.branchName}` : ' · 비서비스 지역'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="접수 증상" required error={errors.symptom}>
          {(id) => (
            <Select id={id} value={draft.symptom} onChange={(e) => set({ symptom: e.target.value })}>
              <option value="">선택</option>
              {codes.ORDER_SYMPTOM?.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {draft.lines.map((l, i) => (
        <div key={i} className="adm-form-grid adm-csl-grid-4">
          <Field label="기기 형태" required error={i === 0 ? errors.lines : undefined}>
            {(id) => (
              <Select id={id} value={l.deviceType} onChange={(e) => setLine(i, { deviceType: e.target.value, cleanLevel: '' })}>
                {d.devices.map((x) => (
                  <option key={x} value={x}>
                    {labelOf(codes.DEVICE_TYPE, x)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="작업 범위" required>
            {(id) => (
              <Select id={id} value={l.cleanLevel || d.levelsOf(l.deviceType)[0] || ''} onChange={(e) => setLine(i, { cleanLevel: e.target.value })}>
                {d.levelsOf(l.deviceType).map((c) => (
                  <option key={c} value={c}>
                    {labelOf(codes.CLEAN_LEVEL, c)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="대수" required>
            {(id) => <Input id={id} inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />}
          </Field>
          <div className="adm-csl-line-actions">
            {draft.lines.length > 1 ? (
              <Button variant="ghost" size="sm" onClick={() => set({ lines: draft.lines.filter((_, j) => j !== i) })}>
                삭제
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => set({ lines: [...draft.lines, { deviceType: d.devices[0] ?? '', cleanLevel: '', quantity: '1' }] })}>
        기기 추가
      </Button>
      {choices.options.length ? (
        <div className="adm-form-grid adm-csl-grid-4">
          {choices.options.map((o) => (
            <Field key={o.id} label={`${o.name} 수량`}>
              {(id) => <Input id={id} inputMode="numeric" value={draft.opts[o.id] ?? ''} onChange={(e) => set({ opts: { ...draft.opts, [o.id]: e.target.value } })} />}
            </Field>
          ))}
        </div>
      ) : null}
      <div className="adm-form-grid adm-csl-grid-4">
        <Field label="브랜드">
          {(id) => (
            <Select id={id} value={draft.brand} onChange={(e) => set({ brand: e.target.value })}>
              <option value="">선택</option>
              {codes.BRAND?.map((c) => (
                <option key={c.value} value={c.label}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="모델명">{(id) => <Input id={id} value={draft.modelName} maxLength={50} onChange={(e) => set({ modelName: e.target.value })} />}</Field>
        <Field label="접수 유형" required>
          {(id) => (
            <Select id={id} value={draft.orderType} onChange={(e) => set({ orderType: e.target.value })}>
              {codes.ORDER_TYPE?.filter((c) => c.value === 'NORMAL' || c.value === 'URGENT').map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="방문 형태" help="약속일시로 자동 판단">
          {(id) => <Input id={id} readOnly value={labelOf(codes.VISIT_TYPE, preview?.visitType ?? 'IN_HOURS')} />}
        </Field>
      </div>
      <div className="adm-form-grid adm-csl-grid-4">
        <Field label="요구일시(날짜)">{(id) => <Input id={id} type="date" value={draft.requestedDate} onChange={(e) => set({ requestedDate: e.target.value })} />}</Field>
        <Field label="요구일시(시각)">{(id) => <Input id={id} type="time" value={draft.requestedTime} onChange={(e) => set({ requestedTime: e.target.value })} />}</Field>
        <Check label="2인 방문 필요" checked={draft.twoPerson} onChange={(e) => set({ twoPerson: e.target.checked, slot: null, tech: null })} />
        <Check label="다빈도 고객 표시" checked={draft.frequent} onChange={(e) => set({ frequent: e.target.checked })} />
      </div>
      <div className="adm-form-grid">
        <Field label="요청사항(자재 지참 등)">
          {(id) => <Textarea id={id} rows={2} maxLength={500} value={draft.customerRequest} onChange={(e) => set({ customerRequest: e.target.value })} />}
        </Field>
        <Field label="전달사항(기사에게)">
          {(id) => <Textarea id={id} rows={2} maxLength={1000} value={draft.internalNote} onChange={(e) => set({ internalNote: e.target.value })} />}
        </Field>
      </div>
      {quoteError ? <Alert tone="danger">{quoteError}</Alert> : null}
      <div className="adm-csl-quote" aria-live="polite">
        {preview ? (
          <>
            <span>
              자동 견적 <strong className="ac-num">{won(preview.totalAmount)}</strong>
            </span>
            <span className="ac-body-sm">
              예상 <span className="ac-num">{preview.durationMin}</span>분 ·{' '}
              {preview.items
                .filter((i) => i.itemType !== 'PRODUCT')
                .map((i) => `${i.name} ${won(i.amount)}`)
                .join(' · ') || '할인·할증 없음'}
            </span>
          </>
        ) : (
          <span className="ac-body-sm">고객과 방문 주소, 기기를 고르면 표준 견적이 자동으로 계산됩니다.</span>
        )}
      </div>
    </div>
  );
}

/* ---------- ④ Time Table (A-CSL-021) + 기사 선택(022) + 휴일 근무(023) + 이중접수(024) + [저장] ---------- */

type Duplicate = { orderNo: string; status: string; promisedAt: Date | null; channel: string; roadAddress: string; createdAt: Date };

export function TimeTableSection(p: {
  d: OrderDraft;
  data: ConsoleData | null;
  branchId: number | null;
  today: string;
  codes: Codes;
  scripts: { triggerPoint: string; content: string }[];
  canWrite: boolean;
  active: boolean;
  reloadKey: number;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { draft, setDraft, preview } = p.d;
  const [start, setStart] = useState(p.today);
  const [rows, setRows] = useState<TimeTableRow[] | null>(null);
  const [ttError, setTtError] = useState<string | null>(null);
  const [techModal, setTechModal] = useState<{ date: string; hour: number; list: TechAvailability[] | null } | null>(null);
  const [onCall, setOnCall] = useState<{ date: string; list: { id: number; name: string; grade: string; startTime: string | null; endTime: string | null }[] | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!p.branchId) return setRows(null);
    let alive = true;
    void loadTimeTableAction(p.branchId, start).then((r) => {
      if (!alive) return;
      const res = r as Res;
      if (!res.ok) return setTtError(errOf(res));
      setTtError(null);
      setRows(res.data as TimeTableRow[]);
    });
    return () => {
      alive = false;
    };
  }, [p.branchId, start, p.reloadKey]);

  // 약속일시를 고르면 야간·휴일 할증 안내(F-ADM-CSL-09, BR-011·012)
  const lastNotice = preview?.surchargeNotice ?? null;
  const slotKey = draft.slot ? `${draft.slot.date}|${draft.slot.hour}` : '';
  useEffect(() => {
    if (slotKey && lastNotice) setNotice(lastNotice);
  }, [slotKey, lastNotice]);
  const noticeScript = notice ? p.scripts.find((s) => s.triggerPoint === (notice.includes('야간') ? 'NIGHT_VISIT' : 'HOLIDAY_VISIT'))?.content : null;

  const openCell = async (date: string, hour: number) => {
    if (!p.branchId) return;
    setTechModal({ date, hour, list: null });
    const r = (await loadAvailableTechs(p.branchId, date, hour, preview?.durationMin ?? 60)) as Res;
    // 목록이 오기 전에 창을 닫았거나 다른 칸을 눌렀으면 다시 열지 않는다
    setTechModal((m) => (m && m.date === date && m.hour === hour ? { ...m, list: r.ok ? (r.data as TechAvailability[]) : [] } : m));
  };
  const pick = (date: string, hour: number, tech: { id: number; name: string } | null) => {
    setDraft((x) => ({ ...x, slot: { date, hour }, tech }));
    setTechModal(null);
  };
  const openOnCall = async (date: string) => {
    if (!p.branchId) return;
    setOnCall({ date, list: null });
    const r = (await loadOnCallTechs(p.branchId, date)) as Res;
    setOnCall((m) => (m && m.date === date ? { ...m, list: r.ok ? (r.data as NonNullable<typeof onCall>['list']) : [] } : m));
  };

  const send = async (duplicateConfirmed: boolean) => {
    if (!p.data) return;
    setConfirm(false);
    setDuplicates(null);
    setBusy(true);
    setError(null);
    const r = (await submitOrder({
      customerId: p.data.customer.id,
      callLogId: p.data.callLogId ?? '',
      addressId: draft.addressId,
      lines: p.d.quoteLines(),
      options: p.d.quoteOptions(),
      symptom: draft.symptom,
      brand: draft.brand,
      modelName: draft.modelName,
      orderType: draft.orderType,
      customerRequest: draft.customerRequest,
      twoPerson: draft.twoPerson,
      frequent: draft.frequent,
      requestedDate: draft.requestedDate,
      requestedTime: draft.requestedTime,
      slotDate: draft.slot?.date ?? '',
      slotHour: draft.slot?.hour ?? '',
      technicianId: draft.tech?.id ?? '',
      internalNote: draft.internalNote,
      duplicateConfirmed,
    })) as Res;
    setBusy(false);
    if (!r.ok) {
      p.d.setErrors(r.fieldErrors ?? {});
      return setError(errOf(r));
    }
    const out = r.data as { ok: true } | { ok: false; duplicates: Duplicate[] };
    if (!out.ok) return setDuplicates(out.duplicates);
    toast(MSG.saved);
    p.d.reset();
    p.onSaved();
  };

  const validate = () => {
    const miss: Record<string, string> = {};
    if (!draft.addressId) miss.addressId = MSG.required('방문 주소');
    if (draft.lines.length === 0 || draft.lines.some((l) => !l.deviceType)) miss.lines = MSG.required('기기 형태');
    if (!draft.symptom) miss.symptom = MSG.required('접수 증상');
    if (!draft.slot) miss.slotDate = MSG.required('약속일시');
    p.d.setErrors(miss);
    if (Object.keys(miss).length) {
      setError(Object.values(miss)[0]!);
      return false;
    }
    setError(null);
    return true;
  };

  return (
    <section className="ac-card adm-csl-timetable" aria-label="Time Table">
      <div className="adm-toolbar adm-csl-tt-head">
        <h2 className="ac-h3">Time Table</h2>
        <div className="ac-row">
          <Button size="sm" variant="ghost" onClick={() => setStart(shiftDate(start, -7))}>
            &lt; 7일전
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStart(p.today)}>
            당일
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStart(shiftDate(start, 7))}>
            7일후 &gt;
          </Button>
        </div>
      </div>
      {ttError ? <Alert tone="danger">{ttError}</Alert> : null}
      {!p.branchId ? (
        <Empty>거점을 고르거나 고객의 방문 주소를 선택하면 Time Table이 보입니다.</Empty>
      ) : !rows ? (
        <p className="ac-body-sm">불러오는 중…</p>
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table adm-csl-tt">
            <caption className="ac-sr-only">7일 × 시간대 잔여 건수. 셀을 누르면 그 시간에 출장 가능한 기사를 고를 수 있습니다.</caption>
            <thead>
              <tr>
                <th scope="col">날짜</th>
                {rows[0]?.cells.map((c) => (
                  <th key={c.hour} scope="col" className="is-num">
                    {String(c.hour).padStart(2, '0')}
                  </th>
                ))}
                <th scope="col" className="is-num">
                  계약
                </th>
                <th scope="col" className="is-num">
                  긴급
                </th>
                <th scope="col" className="is-num">
                  당직
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date}>
                  <th scope="row" className={r.holiday || r.dow === 0 || r.dow === 6 ? 'adm-csl-tt-off' : undefined}>
                    <span className="ac-num">{r.date.slice(5)}</span> {DOW[r.dow]}
                    {r.holiday ? ' (휴일)' : ''}
                  </th>
                  {r.cells.map((c) => {
                    const selected = draft.slot?.date === r.date && draft.slot.hour === c.hour;
                    const disabled = !p.active || !p.data || c.past || c.remaining === null || c.remaining < (draft.twoPerson ? 2 : 1);
                    return (
                      <td key={c.hour} className="is-num">
                        {c.remaining === null ? (
                          <span className="adm-csl-tt-none" aria-label="슬롯 없음">
                            -
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="adm-csl-tt-cell ac-num"
                            aria-pressed={selected}
                            aria-label={`${r.date} ${c.hour}시 잔여 ${c.remaining}건`}
                            disabled={disabled}
                            onClick={() => openCell(r.date, c.hour)}
                          >
                            {c.remaining}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="is-num ac-num">{r.contract}</td>
                  <td className="is-num ac-num">{r.urgent}</td>
                  <td className="is-num">
                    {r.onCall > 0 ? (
                      <button type="button" className="adm-csl-tt-cell ac-num" aria-label={`${r.date} 휴일 근무 기사 보기`} onClick={() => openOnCall(r.date)}>
                        {r.onCall}
                      </button>
                    ) : (
                      <span className="ac-num">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.active ? (
        <>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="adm-toolbar">
            <span className="ac-body-sm">
              약속일시{' '}
              <strong className="ac-num">{draft.slot ? `${draft.slot.date} ${String(draft.slot.hour).padStart(2, '0')}:00` : '미선택'}</strong> · 기사{' '}
              <strong>{draft.tech?.name ?? '미지정(저장 시 배정대기)'}</strong>
              {preview ? (
                <>
                  {' '}
                  · 합계 <strong className="ac-num">{won(preview.totalAmount)}</strong>
                </>
              ) : null}
            </span>
            <Button variant="primary" loading={busy} disabled={!p.canWrite || !p.data} onClick={() => validate() && setConfirm(true)}>
              저장
            </Button>
          </div>
        </>
      ) : null}

      <Modal
        open={techModal !== null}
        title="출장 가능 기사 스케줄"
        description={techModal ? `${techModal.date} ${String(techModal.hour).padStart(2, '0')}:00 · 예상 ${preview?.durationMin ?? 60}분` : undefined}
        onClose={() => setTechModal(null)}
        form
        actions={
          <>
            <Button variant="outline" onClick={() => setTechModal(null)}>
              닫기
            </Button>
            <Button variant="primary" onClick={() => techModal && pick(techModal.date, techModal.hour, null)}>
              기사 미지정으로 선택
            </Button>
          </>
        }
      >
        {techModal?.list === null ? (
          <p className="ac-body-sm">불러오는 중…</p>
        ) : techModal?.list?.length === 0 ? (
          <Empty>그날 근무하는 기사가 없습니다.</Empty>
        ) : (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">기사명</th>
                  <th scope="col">등급</th>
                  <th scope="col">근무</th>
                  <th scope="col" className="is-num">
                    당일 약속
                  </th>
                  <th scope="col">상태</th>
                  <th scope="col">
                    <span className="ac-sr-only">선택</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {techModal?.list?.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{labelOf(p.codes.TECH_GRADE, t.grade)}</td>
                    <td>
                      {labelOf(p.codes.SCHEDULE_TYPE, t.scheduleType)} <span className="ac-num">{t.workHours.length ? `${t.workHours[0]}~${t.workHours[t.workHours.length - 1]! + 1}시` : ''}</span>
                    </td>
                    <td className="is-num ac-num">{t.appointments}</td>
                    <td>{t.available ? '가능' : t.reason === 'BUSY' ? '약속 겹침' : '근무 시간 외'}</td>
                    <td>
                      <Button size="sm" disabled={!t.available} onClick={() => techModal && pick(techModal.date, techModal.hour, { id: t.id, name: t.name })}>
                        선택
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {draft.twoPerson ? <Alert tone="warning">2인 방문 건은 지원기사를 배정 보드에서 추가할 때까지 배정대기로 저장됩니다.</Alert> : null}
      </Modal>

      <Modal
        open={onCall !== null}
        title="휴일 근무 기사"
        description={onCall?.date}
        onClose={() => setOnCall(null)}
        actions={
          <Button variant="primary" block onClick={() => setOnCall(null)}>
            확인
          </Button>
        }
      >
        {onCall?.list === null ? (
          <p className="ac-body-sm">불러오는 중…</p>
        ) : !onCall?.list?.length ? (
          <Empty />
        ) : (
          <ul className="ac-list">
            {onCall.list.map((t) => (
              <li key={t.id} className="ac-list-item">
                {t.name} · {labelOf(p.codes.TECH_GRADE, t.grade)}
                {t.startTime ? <span className="ac-num"> {`${t.startTime.slice(0, 5)}~${t.endTime?.slice(0, 5) ?? ''}`}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={notice !== null}
        title={notice?.startsWith('[평일 야간') ? '평일 야간 약속 안내' : '휴일 약속 안내'}
        description={notice ?? undefined}
        onClose={() => setNotice(null)}
        actions={
          <Button variant="primary" block onClick={() => setNotice(null)}>
            확인
          </Button>
        }
      >
        {noticeScript ? <blockquote className="adm-csl-script">{noticeScript}</blockquote> : null}
      </Modal>

      <Modal
        open={duplicates !== null}
        title="이중접수 고객 리스트"
        description="같은 전화번호나 주소로 진행 중인 접수가 있습니다. 그래도 접수할까요?"
        onClose={() => setDuplicates(null)}
        form
        actions={
          <>
            <Button variant="outline" onClick={() => setDuplicates(null)}>
              접수취소
            </Button>
            <Button variant="primary" onClick={() => send(true)}>
              접수저장
            </Button>
          </>
        }
      >
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">상태</th>
                <th scope="col">접수번호</th>
                <th scope="col">접수일시</th>
                <th scope="col">약속일시</th>
                <th scope="col">주소</th>
                <th scope="col">채널</th>
              </tr>
            </thead>
            <tbody>
              {duplicates?.map((x) => (
                <tr key={x.orderNo}>
                  <td>
                    <StatusBadge code={x.status} audience="staff" />
                  </td>
                  <td className="ac-num">{x.orderNo}</td>
                  <td className="ac-num">{formatDateTime(x.createdAt)}</td>
                  <td className="ac-num">{formatDateTime(x.promisedAt)}</td>
                  <td>{x.roadAddress}</td>
                  <td>{labelOf(p.codes.ORDER_CHANNEL, x.channel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
      <ConfirmModal open={confirm} onConfirm={() => send(false)} onCancel={() => setConfirm(false)} />
    </section>
  );
}
