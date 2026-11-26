'use client';
// A-VOC-020 안전사고 관리 (F-ADM-VOC-02): 검색 Enter = 조회, 행 더블클릭 = 처리 창(상태 전이·보상 금액·수신자 추가), 저장 전 확인
import { INCIDENT_TRANSITIONS, type IncidentStatus } from '@aircon/domain';
import { Alert, Button, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, Tag, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { listIncidents } from '@/server/incidents';
import { addRecipient, saveIncident } from '../actions';

type Row = Awaited<ReturnType<typeof listIncidents>>[number];
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown };
const errOf = (r: Res) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '저장하지 못했습니다.';
const tone = (s: string) => (s === 'CLOSED' ? ('success' as const) : s === 'REPORTED' ? ('danger' as const) : ('warning' as const));

export function IncidentsScreen(p: { rows: Row[]; query: { status: string | null; dateFrom: string | null; dateTo: string | null }; codes: Record<string, Option[]>; canUpdate: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ status: p.query.status ?? '', from: p.query.dateFrom ?? '', to: p.query.dateTo ?? '' });
  const [open, setOpen] = useState<Row | null>(null);
  const media = (raw: string | null) => (raw ? raw.split(',').map((m) => labelOf(p.codes.MEDIA_FLAG, m)).join(', ') : '-');
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">안전사고 관리</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const sp = new URLSearchParams();
          if (f.status) sp.set('status', f.status);
          if (f.from) sp.set('from', f.from);
          if (f.to) sp.set('to', f.to);
          router.push(`/admin/voc/incidents?${sp.toString()}`);
        }}
      >
        <Field label="진행 상태">
          {(id) => (
            <Select id={id} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">전체</option>
              {p.codes.INCIDENT_STATUS?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="접수일(시작)">{(id) => <Input id={id} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
        <Field label="접수일(종료)">{(id) => <Input id={id} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        <div className="ac-search-panel__actions">
          <Button type="submit" variant="primary" size="sm">
            조회
          </Button>
        </div>
      </form>
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          총 <strong className="ac-num">{p.rows.length.toLocaleString()}</strong>건
        </span>
        <span className="ac-caption">접수는 상담 콘솔의 [안전사고] 탭에서 합니다.</span>
      </div>
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">진행상태</th>
                <th scope="col">사고번호</th>
                <th scope="col">피해유형</th>
                <th scope="col">고객</th>
                <th scope="col">접수번호</th>
                <th scope="col">기사</th>
                <th scope="col">매체/기관</th>
                <th scope="col">수신자</th>
                <th scope="col">보험 접수번호</th>
                <th scope="col" className="is-num">
                  보상 금액
                </th>
                <th scope="col">접수일시</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} tabIndex={0} aria-label={`${r.incidentNo} 처리`} onDoubleClick={() => setOpen(r)} onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}>
                  <td>
                    <Tag tone={tone(r.status)}>{labelOf(p.codes.INCIDENT_STATUS, r.status)}</Tag>
                  </td>
                  <td className="ac-num">
                    {r.incidentNo}
                    {r.isEscalated ? <Tag tone="danger">경영진 통보</Tag> : null}
                  </td>
                  <td>{labelOf(p.codes.DAMAGE_TYPE, r.damageType)}</td>
                  <td className="ac-masked">{r.customerName}</td>
                  <td className="ac-num">{r.orderNo ?? '-'}</td>
                  <td>{r.techName ?? '-'}</td>
                  <td>{media(r.mediaFlags)}</td>
                  <td className="ac-num">{r.recipients.length}명</td>
                  <td className="ac-num">{r.insuranceClaimNo ?? '-'}</td>
                  <td className="is-num ac-num">{r.compensationAmount === null ? '-' : won(r.compensationAmount)}</td>
                  <td className="ac-num">{formatDateTime(new Date(r.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open ? <IncidentModal row={open} codes={p.codes} canUpdate={p.canUpdate} media={media(open.mediaFlags)} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function IncidentModal({ row, codes, canUpdate, media, onClose }: { row: Row; codes: Record<string, Option[]>; canUpdate: boolean; media: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const closed = row.status === 'CLOSED';
  const [v, setV] = useState({
    status: row.status,
    insuranceClaimNo: row.insuranceClaimNo ?? '',
    compensationAmount: row.compensationAmount === null ? '' : String(row.compensationAmount),
    responseAction: row.responseAction ?? '',
  });
  const [rec, setRec] = useState({ name: '', org: '', phone: '', email: '' });
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'save' | 'recipient'>(null);
  const [busy, setBusy] = useState(false);
  const next = [row.status, ...(INCIDENT_TRANSITIONS[row.status as IncidentStatus] ?? [])];
  const run = async () => {
    const which = confirm;
    setConfirm(null);
    setBusy(true);
    const r = (which === 'save' ? await saveIncident({ ...v, id: row.id }) : await addRecipient({ ...rec, incidentId: row.id })) as Res;
    setBusy(false);
    if (!r.ok) return setError(errOf(r));
    toast(which === 'save' ? MSG.saved : '수신자에게 통보했습니다.');
    onClose();
    router.refresh();
  };
  return (
    <>
      <Modal
        open
        title={`안전사고 ${row.incidentNo}`}
        onClose={onClose}
        form
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!canUpdate || closed}
              onClick={() => {
                if (v.status === 'COMPENSATED' && !v.compensationAmount) return setError(MSG.required('보상 금액'));
                setError(null);
                setConfirm('save');
              }}
            >
              저장
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <dl className="adm-kv">
          <dt>피해유형</dt>
          <dd>{labelOf(codes.DAMAGE_TYPE, row.damageType)}</dd>
          <dt>발생 일시</dt>
          <dd className="ac-num">{row.occurredAt ? formatDateTime(new Date(row.occurredAt)) : '-'}</dd>
          <dt>발생 경위</dt>
          <dd className="adm-pre">{row.circumstance}</dd>
          <dt>피해 내용</dt>
          <dd className="adm-pre">{row.damageDetail}</dd>
          <dt>고객 요구</dt>
          <dd className="adm-pre">{row.customerDemand ?? '-'}</dd>
          <dt>매체/기관</dt>
          <dd>{media}</dd>
        </dl>
        <fieldset className="adm-fieldset" disabled={!canUpdate || closed}>
          <div className="adm-form-grid">
            <Field label="진행 상태" required>
              {(id) => (
                <Select id={id} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
                  {codes.INCIDENT_STATUS?.filter((o) => next.includes(o.value as IncidentStatus)).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="보험 접수번호">{(id) => <Input id={id} maxLength={50} value={v.insuranceClaimNo} onChange={(e) => setV({ ...v, insuranceClaimNo: e.target.value })} />}</Field>
            <Field label="보상 금액(원)" required={v.status === 'COMPENSATED'}>
              {(id) => <Input id={id} inputMode="numeric" value={v.compensationAmount} onChange={(e) => setV({ ...v, compensationAmount: e.target.value.replace(/\D/g, '') })} />}
            </Field>
            <div />
            <div className="adm-span-2">
              <Field label="조치 내용">{(id) => <Textarea id={id} rows={2} maxLength={2000} value={v.responseAction} onChange={(e) => setV({ ...v, responseAction: e.target.value })} />}</Field>
            </div>
          </div>
        </fieldset>
        <h3 className="ac-title adm-gap-top">통보 이력</h3>
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">구분</th>
                <th scope="col">이름</th>
                <th scope="col">소속</th>
                <th scope="col">연락처</th>
                <th scope="col">결과</th>
                <th scope="col">통보 일시</th>
              </tr>
            </thead>
            <tbody>
              {row.recipients.map((x) => (
                <tr key={x.id}>
                  <td>{labelOf(codes.INCIDENT_RECIPIENT_TYPE, x.recipientType)}</td>
                  <td>{x.name}</td>
                  <td>{x.org ?? '-'}</td>
                  <td className="ac-masked ac-num">{x.phoneMasked || x.email || '-'}</td>
                  <td>{x.notifyResult === 'FAILED' ? <Tag tone="danger">실패</Tag> : x.notifiedAt ? <Tag tone="success">통보</Tag> : <Tag>미발송</Tag>}</td>
                  <td className="ac-num">{x.notifiedAt ? formatDateTime(new Date(x.notifiedAt)) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canUpdate && !closed ? (
          <div className="ac-row adm-gap-top">
            <Input aria-label="수신자 이름" placeholder="이름" value={rec.name} onChange={(e) => setRec({ ...rec, name: e.target.value })} />
            <Input aria-label="소속" placeholder="소속" value={rec.org} onChange={(e) => setRec({ ...rec, org: e.target.value })} />
            <Input aria-label="연락처" placeholder="연락처" inputMode="tel" value={rec.phone} onChange={(e) => setRec({ ...rec, phone: e.target.value })} />
            <Input aria-label="이메일" placeholder="이메일" value={rec.email} onChange={(e) => setRec({ ...rec, email: e.target.value })} />
            <Button
              size="sm"
              onClick={() => {
                if (!rec.name.trim()) return setError(MSG.required('수신자 이름'));
                if (!rec.phone.trim() && !rec.email.trim()) return setError('연락처 또는 이메일 중 하나는 필수 입력값입니다.');
                setError(null);
                setConfirm('recipient');
              }}
            >
              수신자 추가
            </Button>
          </div>
        ) : null}
      </Modal>
      <ConfirmModal open={confirm !== null} message={confirm === 'recipient' ? '추가한 수신자에게 바로 통보됩니다. 계속하시겠습니까?' : undefined} onConfirm={run} onCancel={() => setConfirm(null)} />
    </>
  );
}
