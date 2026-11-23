'use client';
// A-CSL-070 상담 이력 조회 (검색 영역 Enter = 조회, 그리드 더블클릭 = 상세, 03 §6.2)
import { Alert, Button, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, useToast } from '@aircon/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import { completeConsult } from './actions';

interface Row {
  id: number;
  consultNo: string;
  consultType: string;
  subType: string | null;
  status: string;
  content: string | null;
  relatedOrderId: number | null;
  createdAt: Date;
  completedAt: Date | null;
  customerId: number | null;
  customerNo: string | null;
  customerName: string;
  orderNo: string | null;
  agentName: string | null;
}
type Res = { ok: boolean; message?: string };

const OPEN = new Set(['OPEN', 'IN_PROGRESS']);
const subLabel = (codes: Record<string, Option[]>, r: Row) =>
  r.subType ? labelOf(r.consultType === 'ORDER' ? codes.ORDER_SYMPTOM : codes.INQUIRY_SUB_TYPE, r.subType) : '-';

export function ConsultHistoryScreen(p: { rows: Row[]; query: Record<string, string | undefined>; codes: Record<string, Option[]>; agents: Option[]; canUpdate: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const init = { from: p.query.from ?? '', to: p.query.to ?? '', type: p.query.type ?? '', status: p.query.status ?? '', agent: p.query.agent ?? '', q: p.query.q ?? '' };
  const [f, setF] = useState(init);
  const [open, setOpen] = useState<Row | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();

  const select = (label: string, key: keyof typeof f, options: Option[] | undefined) => (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
          <option value="">전체</option>
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  const complete = async () => {
    if (!open) return;
    setConfirm(false);
    setBusy(true);
    const r = (await completeConsult(open.id)) as Res;
    setBusy(false);
    if (!r.ok) return setError(r.message ?? '처리하지 못했습니다.');
    toast(MSG.saved);
    setOpen(null);
    router.refresh();
  };

  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">상담 이력 조회</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/admin/csl/history${qs ? `?${qs}` : ''}`);
        }}
      >
        <Field label="상담일(시작)">{(id) => <Input id={id} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
        <Field label="상담일(종료)">{(id) => <Input id={id} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        {select('유형', 'type', p.codes.CONSULT_TYPE)}
        {select('상태', 'status', p.codes.CONSULT_STATUS)}
        {select('상담원', 'agent', p.agents)}
        <Field label="상담번호·고객번호·접수번호·전화번호">{(id) => <Input id={id} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />}</Field>
        <div className="ac-search-panel__actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setF({ from: '', to: '', type: '', status: '', agent: '', q: '' });
              router.push('/admin/csl/history');
            }}
          >
            초기화
          </Button>
          <Button type="submit" variant="primary" size="sm">
            조회
          </Button>
        </div>
      </form>
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          총 <strong className="ac-num">{p.rows.length.toLocaleString()}</strong>건
        </span>
      </div>
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">상담번호</th>
                <th scope="col">상담일시</th>
                <th scope="col">유형</th>
                <th scope="col">세부 유형</th>
                <th scope="col">상태</th>
                <th scope="col">고객</th>
                <th scope="col">관련 주문</th>
                <th scope="col">내용</th>
                <th scope="col">상담원</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  aria-label={`${r.consultNo} 상세 보기`}
                  onDoubleClick={() => (setError(null), setOpen(r))}
                  onKeyDown={(e) => e.key === 'Enter' && (setError(null), setOpen(r))}
                >
                  <td className="ac-num">{r.consultNo}</td>
                  <td className="ac-num">{formatDateTime(r.createdAt)}</td>
                  <td>{labelOf(p.codes.CONSULT_TYPE, r.consultType)}</td>
                  <td>{subLabel(p.codes, r)}</td>
                  <td>{labelOf(p.codes.CONSULT_STATUS, r.status)}</td>
                  <td>
                    <span className="ac-masked">{r.customerName}</span>
                  </td>
                  <td className="ac-num">{r.orderNo ?? '-'}</td>
                  <td className="adm-csl-ellipsis">{r.content}</td>
                  <td>{r.agentName ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={open !== null}
        title={open ? `상담 ${open.consultNo}` : ''}
        onClose={() => setOpen(null)}
        form
        actions={
          <>
            <Button variant="outline" onClick={() => setOpen(null)}>
              닫기
            </Button>
            {open && p.canUpdate && OPEN.has(open.status) ? (
              <Button variant="primary" loading={busy} onClick={() => setConfirm(true)}>
                완료 처리
              </Button>
            ) : null}
          </>
        }
      >
        {open ? (
          <>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <dl className="adm-kv">
              <dt>유형</dt>
              <dd>
                {labelOf(p.codes.CONSULT_TYPE, open.consultType)} · {subLabel(p.codes, open)}
              </dd>
              <dt>상태</dt>
              <dd>{labelOf(p.codes.CONSULT_STATUS, open.status)}</dd>
              <dt>고객</dt>
              <dd>
                {open.customerId ? (
                  <Link href={`/admin/cus/customers/${open.customerId}`}>
                    <span className="ac-masked">{open.customerName}</span> <span className="ac-num">{open.customerNo}</span>
                  </Link>
                ) : (
                  '-'
                )}
              </dd>
              <dt>관련 주문</dt>
              <dd>{open.relatedOrderId ? <Link href={`/admin/ord/orders/${open.relatedOrderId}`}>{open.orderNo}</Link> : '-'}</dd>
              <dt>상담일시</dt>
              <dd className="ac-num">{formatDateTime(open.createdAt)}</dd>
              <dt>완료일시</dt>
              <dd className="ac-num">{formatDateTime(open.completedAt) || '-'}</dd>
            </dl>
            <p className="adm-csl-script">{open.content}</p>
          </>
        ) : null}
      </Modal>
      <ConfirmModal open={confirm} message="완료 처리하시겠습니까?" confirmLabel="완료 처리" onConfirm={complete} onCancel={() => setConfirm(false)} />
    </div>
  );
}
