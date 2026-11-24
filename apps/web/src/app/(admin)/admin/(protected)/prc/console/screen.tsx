'use client';
// A-PRC-010 처리 콘솔 · A-PRC-020 처리 정보 (F-ADM-PRC-01·02·06·07). 03 §4.3: 상단 조회, 좌 기사 접수 목록, 우 처리 정보, 하단 탭.
// 검색 영역 Enter = 조회, 목록 행 클릭 = 처리 정보. 처리 결과를 입력하면 [미처리 저장] 버튼이 [처리 저장]으로 바뀐다. 개인정보는 마스킹(BR-100).
import {
  Alert,
  Button,
  Card,
  Check,
  ConfirmModal,
  Empty,
  Field,
  Input,
  MSG,
  Modal,
  Select,
  StatusBadge,
  Tabs,
  Tag,
  Textarea,
  useToast,
} from '@aircon/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { routeOf } from '@/admin/routes';
import { formatDateTime } from '@/customer/format';
import type { ConsoleDetail, ConsoleRow, TechHit } from '@/server/process-console';
import {
  removeConsoleFile,
  removeProxyPhoto,
  saveAdminActivity,
  saveProxyComplete,
  saveProxyPending,
  searchTechs,
  uploadConsoleFile,
  uploadProxyPhoto,
} from '../actions';

type Res<T = unknown> = { ok: boolean; data?: T; message?: string; fieldErrors?: Record<string, string> };
const errOf = (r: Res, fallback: string) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? fallback;
const dt = (d: Date | string | null | undefined) => (d ? formatDateTime(new Date(d)) : '');
/** Date → KST 'YYYY-MM-DDTHH:mm' (datetime-local 값) */
const kstInput = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(' ', 'T').slice(0, 16) : '';

interface Query {
  techId: number | null;
  techName: string;
  orderNo: string | null;
  phone: string | null;
  from: string;
  to: string;
}

export function ConsoleScreen(p: {
  query: Query;
  searched: boolean;
  rows: ConsoleRow[];
  detail: ConsoleDetail | null;
  codes: Record<string, Option[]>;
  today: string;
  canUpdate: boolean;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const [techName, setTechName] = useState(p.query.techName);
  const [orderNo, setOrderNo] = useState(p.query.orderNo ?? '');
  const [phone, setPhone] = useState(p.query.phone ?? '');
  const [from, setFrom] = useState(p.query.from);
  const [to, setTo] = useState(p.query.to);
  const [hits, setHits] = useState<TechHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = (params: Record<string, string | number | null | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') sp.set(k, String(v));
    router.push(`${path}?${sp.toString()}`);
  };
  const base = { from, to };
  const search = async () => {
    setError(null);
    if (orderNo.trim() || phone.trim()) return go({ ...base, no: orderNo.trim(), phone: phone.trim() });
    if (!techName.trim()) return setError('기사명·접수번호·전화 중 하나를 입력해 주세요.');
    if (p.query.techId && techName === p.query.techName) return go({ ...base, tech: p.query.techId });
    const r = (await searchTechs(techName)) as Res<TechHit[]>;
    if (!r.ok) return setError(errOf(r, '조회하지 못했습니다.'));
    const list = r.data ?? [];
    if (list.length === 0) return setError(MSG.empty);
    if (list.length === 1) return go({ ...base, tech: list[0]!.id });
    setHits(list);
  };
  const selectOrder = (id: number) =>
    go({ ...base, tech: p.query.techId, no: p.query.orderNo, phone: p.query.phone, order: id });

  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">처리 콘솔</h1>
      </div>
      <form
        role="search"
        className="adm-prc-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Field label="기사명">
          {(id) => <Input id={id} value={techName} maxLength={30} onChange={(e) => setTechName(e.target.value)} />}
        </Field>
        <Field label="접수번호">
          {(id) => <Input id={id} value={orderNo} maxLength={20} onChange={(e) => setOrderNo(e.target.value)} />}
        </Field>
        <Field label="전화">
          {(id) => (
            <Input id={id} inputMode="tel" value={phone} maxLength={13} onChange={(e) => setPhone(e.target.value)} />
          )}
        </Field>
        <Field label="약속일 시작">
          {(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </Field>
        <Field label="약속일 끝">
          {(id) => <Input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
        </Field>
        <Button type="submit" variant="outline">
          조회
        </Button>
      </form>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="adm-prc">
        <section aria-label="기사 접수 목록" className="adm-prc__list">
          <div className="adm-toolbar">
            <h2 className="ac-title">기사 접수 목록{p.query.techName ? ` · ${p.query.techName}` : ''}</h2>
            <span className="ac-body-sm">
              총 <strong className="ac-num">{p.rows.length.toLocaleString()}</strong>건
            </span>
          </div>
          {!p.searched ? (
            <Empty>기사명·접수번호·전화로 조회해 주세요.</Empty>
          ) : p.rows.length === 0 ? (
            <Empty />
          ) : (
            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead>
                  <tr>
                    <th scope="col" className="is-num">
                      No
                    </th>
                    <th scope="col">접수번호</th>
                    <th scope="col">상태</th>
                    <th scope="col">기기</th>
                    <th scope="col">고객</th>
                    <th scope="col">약속일시</th>
                    <th scope="col">미처리코드</th>
                    <th scope="col">처리유형</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r, i) => (
                    <tr
                      key={r.id}
                      className={r.id === p.detail?.order.id ? 'is-selected' : r.done ? 'is-highlight' : undefined}
                      aria-selected={r.id === p.detail?.order.id}
                      onDoubleClick={() => selectOrder(r.id)}
                    >
                      <td className="is-num ac-num">{i + 1}</td>
                      <td className="ac-num">
                        <button type="button" className="adm-link" onClick={() => selectOrder(r.id)}>
                          {r.orderNo}
                        </button>
                      </td>
                      <td>
                        <StatusBadge code={r.status} audience="staff" overdue48h={r.overdue48h} />
                        {r.transferRequested ? <Tag tone="warning">이관 요청</Tag> : null}
                      </td>
                      <td>{r.devices}</td>
                      <td>{r.customerName}</td>
                      <td className="ac-num">{dt(r.promisedAt)}</td>
                      <td>{labelOf(p.codes.PENDING_REASON, r.pendingReason)}</td>
                      <td>{labelOf(p.codes.RESULT_CODE, r.resultCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section aria-label="처리 정보" className="adm-prc__detail">
          {p.detail ? (
            <DetailPanel key={p.detail.order.id} {...p} detail={p.detail} />
          ) : (
            <Card>
              <Empty>목록에서 접수 건을 고르면 처리 정보가 보입니다.</Empty>
            </Card>
          )}
        </section>
      </div>
      {p.detail ? <BottomTabs detail={p.detail} codes={p.codes} canDelete={p.canUpdate} /> : null}

      {hits ? (
        <Modal open title="기사 선택" description="같은 이름의 기사가 여러 명입니다." onClose={() => setHits(null)}>
          <ul className="ac-list">
            {hits.map((t) => (
              <li key={t.id} className="ac-list-item">
                <button
                  type="button"
                  className="adm-zones__tech"
                  onClick={() => {
                    setHits(null);
                    setTechName(t.displayName || t.name);
                    go({ ...base, tech: t.id });
                  }}
                >
                  <span>
                    {t.displayName || t.name} · {t.branchName}
                  </span>
                  <span className="ac-num ac-caption">{t.phoneMasked}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </div>
  );
}

/* ---------- 처리 정보 (A-PRC-020) ---------- */

function DetailPanel(p: {
  detail: ConsoleDetail;
  codes: Record<string, Option[]>;
  today: string;
  canUpdate: boolean;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const d = p.detail;
  const o = d.order;
  const [activityOpen, setActivityOpen] = useState(false);
  return (
    <Card>
      <div className="adm-detail-head">
        <h2 className="ac-h3 ac-num">{o.orderNo}</h2>
        <StatusBadge code={o.status} audience="staff" />
        {d.operatorConfirm ? <Tag tone="danger">고객부재 {d.absentStreak}회 연속 · 운영자 확인 필요</Tag> : null}
      </div>
      <dl className="adm-kv adm-gap-top">
        <dt>고객</dt>
        <dd>
          {o.customerName} <span className="ac-num">{o.customerPhone}</span>
        </dd>
        <dt>거점</dt>
        <dd>{o.branchName}</dd>
        <dt>주소</dt>
        <dd>{o.address}</dd>
        <dt>약속일시</dt>
        <dd className="ac-num">{dt(o.promisedAt)}</dd>
        <dt>처리기사</dt>
        <dd>{d.mainTech?.name ?? '미배정'}</dd>
        <dt>지원기사</dt>
        <dd>{d.supportTechs.map((t) => `${t.name}(${labelOf(p.codes.ASSIGN_ROLE, t.role)})`).join(', ')}</dd>
        <dt>요청사항</dt>
        <dd>{o.customerRequest ?? ''}</dd>
        <dt>전달사항</dt>
        <dd>{o.internalNote ?? ''}</dd>
      </dl>

      <h3 className="ac-title adm-gap-top">처리 결과</h3>
      {d.canComplete && p.canUpdate ? (
        <ProxyForm detail={d} codes={p.codes} today={p.today} />
      ) : (
        <WorkSummary detail={d} codes={p.codes} />
      )}

      <FilesBlock detail={d} canCreate={p.canCreate} canDelete={p.canDelete} />

      <div className="adm-actions adm-gap-top">
        {p.canCreate ? (
          <Button variant="outline" onClick={() => setActivityOpen(true)}>
            활동내역 등록
          </Button>
        ) : null}
        <a className="ac-btn ac-btn--outline" href={routeOf('A-DSP-020')}>
          타 기사 이관
        </a>
        {o.status === 'PENDING' ? (
          <a className="ac-btn ac-btn--outline" href="/admin/prc/pending">
            미처리 대기열에서 재약속
          </a>
        ) : null}
      </div>
      {activityOpen ? <ActivityModal orderId={o.id} codes={p.codes} onClose={() => setActivityOpen(false)} /> : null}
    </Card>
  );
}

function WorkSummary({ detail: d, codes }: { detail: ConsoleDetail; codes: Record<string, Option[]> }) {
  const w = d.work;
  if (!w) return <p className="ac-body-sm">아직 현장 작업 기록이 없습니다.</p>;
  return (
    <dl className="adm-kv">
      <dt>방문일시</dt>
      <dd className="ac-num">{dt(w.arrivedAt ?? w.departedAt)}</dd>
      <dt>작업시간</dt>
      <dd className="ac-num">{w.workMinutes != null ? `${w.workMinutes}분` : ''}</dd>
      <dt>처리코드</dt>
      <dd>{labelOf(codes.RESULT_CODE, w.resultCode)}</dd>
      <dt>미처리코드</dt>
      <dd>{labelOf(codes.PENDING_REASON, w.pendingCode)}</dd>
      <dt>안전관리</dt>
      <dd>{w.safetyChecklistDone ? '확인' : '미확인'}</dd>
      <dt>고소작업</dt>
      <dd>{w.highPlaceWork ? '예' : '아니오'}</dd>
      <dt>작업비</dt>
      <dd className="ac-num">{won(w.laborAmount)}</dd>
      <dt>추가요금</dt>
      <dd className="ac-num">{won(w.extraAmount)}</dd>
      <dt>자재</dt>
      <dd className="ac-num">{won(w.materialAmount)}</dd>
      <dt>할인</dt>
      <dd className="ac-num">{won(w.discountAmount)}</dd>
      <dt>합계</dt>
      <dd className="ac-num">{won(w.finalAmount)}</dd>
      <dt>영수</dt>
      <dd className="ac-num">{won(w.receivedAmount)}</dd>
      <dt>처리 내용</dt>
      <dd className="adm-kv__wide">{w.workNote ?? ''}</dd>
    </dl>
  );
}

function ProxyForm({ detail: d, codes, today }: { detail: ConsoleDetail; codes: Record<string, Option[]>; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const w = d.work;
  const [visitedAt, setVisitedAt] = useState(kstInput(w?.arrivedAt ?? d.order.promisedAt));
  const [minutes, setMinutes] = useState(String(w?.workMinutes ?? 60));
  const [safety, setSafety] = useState(Boolean(w?.safetyChecklistDone));
  const [highPlace, setHighPlace] = useState(Boolean(w?.highPlaceWork));
  const [material, setMaterial] = useState(String(w?.materialAmount ?? 0));
  const [discount, setDiscount] = useState(String(w?.discountAmount ?? 0));
  const [note, setNote] = useState(w?.workNote ?? '');
  const [internal, setInternal] = useState(w?.internalNote ?? '');
  const [results, setResults] = useState<Record<string, string>>(() =>
    Object.fromEntries(d.results.map((r) => [`${r.orderItemId}:${r.unitNo}`, r.result])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const entered = Object.values(results).some(Boolean);
  const total = useMemo(
    () => Math.max(d.order.totalAmount + d.extras.agreed + (Number(material) || 0) - (Number(discount) || 0), 0),
    [d.order.totalAmount, d.extras.agreed, material, discount],
  );

  const save = async () => {
    setConfirm(false);
    setError(null);
    setErrors({});
    setProblems([]);
    const r = (await saveProxyComplete({
      orderId: d.order.id,
      visitedAt,
      workMinutes: minutes,
      safetyDone: safety,
      highPlaceWork: highPlace,
      materialAmount: material,
      discountAmount: discount,
      workNote: note,
      internalNote: internal,
      units: d.units.map((u) => ({ orderItemId: u.orderItemId, unitNo: u.unitNo, result: results[`${u.orderItemId}:${u.unitNo}`] ?? '' })),
    })) as Res<{ done: boolean; problems?: string[] }>;
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return setError(errOf(r, '저장하지 못했습니다.'));
    }
    if (!r.data?.done) return setProblems(r.data?.problems ?? []);
    toast(MSG.saved);
    router.refresh();
  };

  return (
    <div className="adm-prc-form">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {problems.length ? (
        <Alert tone="danger">
          <ul className="adm-issue-list">
            {problems.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <div className="adm-csl-grid-4">
        <Field label="방문 일시" required error={errors.visitedAt}>
          {(id, desc, invalid) => (
            <Input
              id={id}
              type="datetime-local"
              aria-describedby={desc}
              aria-invalid={invalid}
              value={visitedAt}
              max={`${today}T23:59`}
              onChange={(e) => setVisitedAt(e.target.value)}
            />
          )}
        </Field>
        <Field label="작업 시간(분)" required error={errors.workMinutes}>
          {(id, desc, invalid) => (
            <Input
              id={id}
              inputMode="numeric"
              aria-describedby={desc}
              aria-invalid={invalid}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
        <Check label="안전 체크 확인(기사 확인)" checked={safety} onChange={(e) => setSafety(e.target.checked)} />
        <Check label="고소작업" checked={highPlace} onChange={(e) => setHighPlace(e.target.checked)} />
      </div>

      <div className="ac-table-wrap adm-gap-top">
        <table className="ac-table">
          <thead>
            <tr>
              <th scope="col">기기</th>
              <th scope="col">처리 결과</th>
              <th scope="col">작업 전 사진</th>
              <th scope="col">작업 후 사진</th>
            </tr>
          </thead>
          <tbody>
            {d.units.map((u) => {
              const key = `${u.orderItemId}:${u.unitNo}`;
              return (
                <tr key={key}>
                  <td>{u.label}</td>
                  <td>
                    <Select
                      aria-label={`${u.label} 처리 결과`}
                      value={results[key] ?? ''}
                      onChange={(e) => setResults((s) => ({ ...s, [key]: e.target.value }))}
                    >
                      <option value="">선택</option>
                      {(codes.WORK_RESULT ?? []).map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </td>
                  {(['BEFORE', 'AFTER'] as const).map((t) => (
                    <td key={t}>
                      <PhotoCell detail={d} unit={u} photoType={t} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="adm-csl-grid-4 adm-gap-top">
        <Field label="작업비">{(id) => <Input id={id} readOnly value={won(d.order.totalAmount)} />}</Field>
        <Field label="추가요금(동의)">{(id) => <Input id={id} readOnly value={won(d.extras.agreed)} />}</Field>
        <Field label="자재 금액" error={errors.materialAmount}>
          {(id, desc, invalid) => (
            <Input
              id={id}
              inputMode="numeric"
              aria-describedby={desc}
              aria-invalid={invalid}
              value={material}
              onChange={(e) => setMaterial(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
        <Field label="할인 금액" error={errors.discountAmount}>
          {(id, desc, invalid) => (
            <Input
              id={id}
              inputMode="numeric"
              aria-describedby={desc}
              aria-invalid={invalid}
              value={discount}
              onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
      </div>
      <p className="ac-body adm-gap-top">
        합계 <strong className="ac-num">{won(total)}</strong>
        {d.extras.pending ? <Tag tone="warning">고객 응답 전 추가요금 {d.extras.pending}건</Tag> : null}
      </p>
      <Field label="처리 내용" required error={errors.workNote}>
        {(id, desc, invalid) => (
          <Textarea
            id={id}
            rows={3}
            maxLength={2000}
            aria-describedby={desc}
            aria-invalid={invalid}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
      <Field label="내부 메모">
        {(id) => <Textarea id={id} rows={2} maxLength={2000} value={internal} onChange={(e) => setInternal(e.target.value)} />}
      </Field>
      <div className="adm-actions adm-gap-top">
        {entered ? (
          <Button variant="primary" onClick={() => setConfirm(true)}>
            처리 저장
          </Button>
        ) : (
          <Button variant="primary" onClick={() => setPendingOpen(true)}>
            미처리 저장
          </Button>
        )}
      </div>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
      {pendingOpen ? <PendingModal detail={d} codes={codes} today={today} onClose={() => setPendingOpen(false)} /> : null}
    </div>
  );
}

function PhotoCell({
  detail: d,
  unit,
  photoType,
}: {
  detail: ConsoleDetail;
  unit: ConsoleDetail['units'][number];
  photoType: 'BEFORE' | 'AFTER';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photos = d.photos.filter((x) => x.orderItemId === unit.orderItemId && x.unitNo === unit.unitNo && x.photoType === photoType);
  const label = `${unit.label} ${photoType === 'BEFORE' ? '작업 전' : '작업 후'} 사진`;
  return (
    <div className="adm-prc-photos">
      {photos.map((ph) => (
        <span key={ph.id} className="adm-prc-thumb">
          <a href={ph.url} target="_blank" rel="noreferrer">
            <img src={ph.url} alt={label} />
          </a>
          <button
            type="button"
            className="adm-link"
            onClick={async () => {
              const r = (await removeProxyPhoto(ph.id)) as Res;
              if (!r.ok) return setError(errOf(r, '지우지 못했습니다.'));
              router.refresh();
            }}
          >
            삭제
          </button>
        </span>
      ))}
      <label className="ac-btn ac-btn--outline ac-btn--sm">
        {busy ? '올리는 중' : '사진 추가'}
        <input
          type="file"
          accept="image/*"
          className="ac-sr-only"
          aria-label={label}
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy(true);
            setError(null);
            const fd = new FormData();
            fd.set('file', f);
            fd.set('orderId', String(d.order.id));
            fd.set('orderItemId', String(unit.orderItemId));
            fd.set('unitNo', String(unit.unitNo));
            fd.set('photoType', photoType);
            const r = (await uploadProxyPhoto(fd)) as Res;
            setBusy(false);
            if (!r.ok) return setError(errOf(r, '올리지 못했습니다.'));
            router.refresh();
          }}
        />
      </label>
      {error ? <span className="adm-text-danger ac-caption">{error}</span> : null}
    </div>
  );
}

function PendingModal({
  detail: d,
  codes,
  today,
  onClose,
}: {
  detail: ConsoleDetail;
  codes: Record<string, Option[]>;
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [memo, setMemo] = useState('');
  const [revisit, setRevisit] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const save = async () => {
    setConfirm(false);
    const r = (await saveProxyPending({ orderId: d.order.id, pendingCode: code, memo, revisitDate: revisit })) as Res<{
      operatorConfirm: boolean;
    }>;
    if (!r.ok) return setErrors(r.fieldErrors ?? { form: errOf(r, '저장하지 못했습니다.') });
    toast(r.data?.operatorConfirm ? '저장에 성공하였습니다. 고객부재가 2회 연속이라 운영자 확인이 필요합니다.' : MSG.saved);
    onClose();
    router.refresh();
  };
  return (
    <>
      <Modal
        open
        title="미처리 저장"
        description={`${d.order.orderNo} · 기사 대신 미처리로 저장합니다.`}
        onClose={onClose}
        form
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button variant="primary" onClick={() => (code ? setConfirm(true) : setErrors({ pendingCode: MSG.required('미처리 사유') }))}>
              저장
            </Button>
          </>
        }
      >
        {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
        <Field label="미처리 사유" required error={errors.pendingCode}>
          {(id, desc, invalid) => (
            <Select id={id} aria-describedby={desc} aria-invalid={invalid} value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">선택</option>
              {(codes.PENDING_REASON ?? []).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="메모" error={errors.memo}>
          {(id, desc, invalid) => (
            <Textarea id={id} rows={2} maxLength={500} aria-describedby={desc} aria-invalid={invalid} value={memo} onChange={(e) => setMemo(e.target.value)} />
          )}
        </Field>
        <Field label="재약속 희망일" error={errors.revisitDate}>
          {(id, desc, invalid) => (
            <Input id={id} type="date" min={today} aria-describedby={desc} aria-invalid={invalid} value={revisit} onChange={(e) => setRevisit(e.target.value)} />
          )}
        </Field>
      </Modal>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </>
  );
}

/* ---------- F-ADM-PRC-06 파일 첨부 ---------- */

function FilesBlock({ detail: d, canCreate, canDelete }: { detail: ConsoleDetail; canCreate: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const kinds = [
    { kind: 'SAFETY', label: '안전관리 파일' },
    { kind: 'DOC', label: '서비스 파일' },
  ] as const;
  return (
    <div className="adm-gap-top">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="adm-prc-files">
        {kinds.map((k) => {
          const files = d.files.filter((f) => f.kind === k.kind);
          return (
            <div key={k.kind}>
              <h3 className="ac-label">
                {k.label} <span className="ac-caption ac-num">({files.length}/2)</span>
              </h3>
              <ul className="ac-list">
                {files.map((f) => (
                  <li key={f.id} className="ac-list-item">
                    <a href={f.url} target="_blank" rel="noreferrer">
                      {f.name}
                    </a>
                    {canDelete ? (
                      <button
                        type="button"
                        className="adm-link"
                        aria-label={`${f.name} 삭제`}
                        onClick={async () => {
                          setError(null);
                          const r = (await removeConsoleFile(f.id)) as Res;
                          if (!r.ok) return setError(errOf(r, '지우지 못했습니다.'));
                          router.refresh();
                        }}
                      >
                        삭제
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {canCreate ? (
                <label className="ac-btn ac-btn--outline ac-btn--sm">
                  {busy === k.kind ? '올리는 중' : `${k.label} 첨부`}
                  <input
                    type="file"
                    className="ac-sr-only"
                    aria-label={`${k.label} 첨부`}
                    disabled={busy !== null}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      setBusy(k.kind);
                      setError(null);
                      const fd = new FormData();
                      fd.set('file', f);
                      fd.set('orderId', String(d.order.id));
                      fd.set('kind', k.kind);
                      const r = (await uploadConsoleFile(fd)) as Res;
                      setBusy(null);
                      if (!r.ok) return setError(errOf(r, '올리지 못했습니다.'));
                      router.refresh();
                    }}
                  />
                </label>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- F-ADM-PRC-07 활동내역 ---------- */

function ActivityModal({ orderId, codes, onClose }: { orderId: number; codes: Record<string, Option[]>; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [type, setType] = useState('CALL');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const types = (codes.ACTIVITY_TYPE ?? []).filter((c) => ['CALL', 'SMS', 'VISIT_TRY', 'NOTE'].includes(c.value));
  const save = async () => {
    setConfirm(false);
    const r = (await saveAdminActivity({ orderId, activityType: type, content })) as Res;
    if (!r.ok) return setError(errOf(r, '저장하지 못했습니다.'));
    toast(MSG.saved);
    onClose();
    router.refresh();
  };
  return (
    <>
      <Modal
        open
        title="활동내역 등록"
        onClose={onClose}
        form
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button variant="primary" onClick={() => (content.trim() ? setConfirm(true) : setError(MSG.required('내용')))}>
              저장
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="유형" required>
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="내용" required>
          {(id) => <Textarea id={id} rows={3} maxLength={500} value={content} onChange={(e) => setContent(e.target.value)} />}
        </Field>
      </Modal>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </>
  );
}

/* ---------- 하단 탭: 작업 사진 · 활동내역 · 상태이력 · 결제 ---------- */

type TabKey = 'photos' | 'activities' | 'history' | 'payments';

function BottomTabs({ detail: d, codes }: { detail: ConsoleDetail; codes: Record<string, Option[]>; canDelete: boolean }) {
  const [tab, setTab] = useState<TabKey>('photos');
  return (
    <section aria-label="처리 이력" className="adm-section">
      <Tabs<TabKey>
        items={[
          { value: 'photos', label: `작업 사진(${d.photos.length})` },
          { value: 'activities', label: `활동내역(${d.activities.length})` },
          { value: 'history', label: `상태이력(${d.history.length})` },
          { value: 'payments', label: `결제(${d.payments.length})` },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="adm-gap-top">
        {tab === 'photos' ? (
          d.photos.length ? (
            <div className="ac-photo-grid">
              {d.photos.map((ph) => (
                <a key={ph.id} className="ac-photo-slot" href={ph.url} target="_blank" rel="noreferrer">
                  <img src={ph.url} alt={`작업 사진 ${ph.photoType}`} />
                </a>
              ))}
            </div>
          ) : (
            <Empty />
          )
        ) : null}
        {tab === 'activities' ? (
          d.activities.length ? (
            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead>
                  <tr>
                    <th scope="col">일시</th>
                    <th scope="col">유형</th>
                    <th scope="col">작성</th>
                    <th scope="col">내용</th>
                  </tr>
                </thead>
                <tbody>
                  {d.activities.map((a) => (
                    <tr key={a.id}>
                      <td className="ac-num">{dt(a.createdAt)}</td>
                      <td>{labelOf(codes.ACTIVITY_TYPE, a.activityType)}</td>
                      <td>{a.actorType === 'ADMIN' ? `관리자 ${a.adminName ?? ''}` : (a.techName ?? '')}</td>
                      <td>{a.content}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty />
          )
        ) : null}
        {tab === 'history' ? (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">일시</th>
                  <th scope="col">이전</th>
                  <th scope="col">변경</th>
                  <th scope="col">사유</th>
                  <th scope="col">처리자</th>
                  <th scope="col">메모</th>
                </tr>
              </thead>
              <tbody>
                {d.history.map((h) => (
                  <tr key={h.id}>
                    <td className="ac-num">{dt(h.createdAt)}</td>
                    <td>{h.fromStatus ? <StatusBadge code={h.fromStatus} audience="staff" /> : ''}</td>
                    <td>
                      <StatusBadge code={h.toStatus} audience="staff" />
                    </td>
                    <td>{labelOf(codes.PENDING_REASON, h.reasonCode) || h.reasonCode || ''}</td>
                    <td>{h.actorName || h.actorType}</td>
                    <td>{h.memo ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {tab === 'payments' ? (
          d.payments.length ? (
            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead>
                  <tr>
                    <th scope="col">결제번호</th>
                    <th scope="col">수단</th>
                    <th scope="col">상태</th>
                    <th scope="col" className="is-num">
                      금액
                    </th>
                    <th scope="col" className="is-num">
                      환불
                    </th>
                    <th scope="col">일시</th>
                  </tr>
                </thead>
                <tbody>
                  {d.payments.map((x) => (
                    <tr key={x.id}>
                      <td className="ac-num">{x.paymentNo}</td>
                      <td>{labelOf(codes.PAYMENT_METHOD, x.method)}</td>
                      <td>{labelOf(codes.PAYMENT_TX_STATUS, x.status)}</td>
                      <td className="is-num ac-num">{won(x.amount)}</td>
                      <td className="is-num ac-num">{x.refunded ? won(x.refunded) : ''}</td>
                      <td className="ac-num">{dt(x.approvedAt ?? x.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty />
          )
        ) : null}
      </div>
    </section>
  );
}
