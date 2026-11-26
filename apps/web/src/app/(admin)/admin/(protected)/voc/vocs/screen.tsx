'use client';
// A-VOC-010 VOC 목록 (F-ADM-VOC-01): 검색 Enter = 조회, 행 더블클릭 = A-VOC-011 VOC 카드, 저장 전 확인(03 §6.2)
import { Alert, Button, Check, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, Tag, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { listVocs } from '@/server/voc';
import { saveVoc } from '../actions';

type Row = Awaited<ReturnType<typeof listVocs>>[number];
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown };
type Q = { status: string | null; categoryL: string | null; severity: string | null; alertOnly: boolean; dateFrom: string | null; dateTo: string | null };

export const severityTone = (s: string | null) => (s === 'HIGH' ? ('danger' as const) : s === 'MID' ? ('warning' as const) : undefined);
export const vocStatusTone = (s: string) => (s === 'DONE' ? ('success' as const) : s === 'PROCESSING' ? ('primary' as const) : ('warning' as const));

export function VocsScreen(p: { rows: Row[]; query: Q; codes: Record<string, Option[]>; canCreate: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ status: p.query.status ?? '', categoryL: p.query.categoryL ?? '', severity: p.query.severity ?? '', alert: p.query.alertOnly, from: p.query.dateFrom ?? '', to: p.query.dateTo ?? '' });
  const [open, setOpen] = useState(false);
  const go = (id: number) => router.push(`/admin/voc/vocs/${id}`);
  const select = (key: 'status' | 'categoryL' | 'severity', label: string, group: string) => (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
          <option value="">전체</option>
          {p.codes[group]?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">VOC 목록</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const sp = new URLSearchParams();
          if (f.status) sp.set('status', f.status);
          if (f.categoryL) sp.set('categoryL', f.categoryL);
          if (f.severity) sp.set('severity', f.severity);
          if (f.alert) sp.set('alert', 'Y');
          if (f.from) sp.set('from', f.from);
          if (f.to) sp.set('to', f.to);
          router.push(`/admin/voc/vocs?${sp.toString()}`);
        }}
      >
        {select('status', '상태', 'VOC_STATUS')}
        {select('categoryL', '대분류', 'VOC_CATEGORY_L')}
        {select('severity', '등급', 'VOC_SEVERITY')}
        <Field label="접수일(시작)">{(id) => <Input id={id} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
        <Field label="접수일(종료)">{(id) => <Input id={id} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        <Check label="Alert 만" checked={f.alert} onChange={(e) => setF({ ...f, alert: e.target.checked })} />
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
        {p.canCreate ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            VOC 등록
          </Button>
        ) : null}
      </div>
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">상태</th>
                <th scope="col">VOC 번호</th>
                <th scope="col">유형</th>
                <th scope="col">분류</th>
                <th scope="col">등급</th>
                <th scope="col">제목</th>
                <th scope="col">고객</th>
                <th scope="col">접수번호</th>
                <th scope="col">기사</th>
                <th scope="col">담당</th>
                <th scope="col">접수일시</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} tabIndex={0} aria-label={`${r.vocNo} VOC 카드 열기`} onDoubleClick={() => go(r.id)} onKeyDown={(e) => e.key === 'Enter' && go(r.id)}>
                  <td>
                    <Tag tone={vocStatusTone(r.status)}>{labelOf(p.codes.VOC_STATUS, r.status)}</Tag>
                  </td>
                  <td className="ac-num">
                    {r.vocNo}
                    {r.isAlert ? <Tag tone="danger">Alert</Tag> : null}
                  </td>
                  <td>{labelOf(p.codes.VOC_TYPE, r.vocType)}</td>
                  <td>
                    {r.categoryL ? labelOf(p.codes.VOC_CATEGORY_L, r.categoryL) : '-'}
                    {r.categoryM ? ` > ${labelOf(p.codes.VOC_CATEGORY_M, r.categoryM)}` : ''}
                  </td>
                  <td>{r.severity ? <Tag tone={severityTone(r.severity)}>{labelOf(p.codes.VOC_SEVERITY, r.severity)}</Tag> : '-'}</td>
                  <td>{r.title}</td>
                  <td className="ac-masked">{r.customerName}</td>
                  <td className="ac-num">{r.orderNo ?? '-'}</td>
                  <td>{r.techName ?? '-'}</td>
                  <td>{r.handlerName ?? '-'}</td>
                  <td className="ac-num">{formatDateTime(new Date(r.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open ? <VocCreateModal codes={p.codes} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function VocCreateModal({ codes, onClose }: { codes: Record<string, Option[]>; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState({ orderNo: '', channel: 'PHONE_IN', vocType: 'COMPLAINT', categoryL: '', categoryM: '', title: '', content: '', severity: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const opts = (group: string, filter?: (o: Option) => boolean) =>
    (codes[group] ?? []).filter(filter ?? (() => true)).map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ));
  const validate = () => {
    const e: Record<string, string> = {};
    if (!v.orderNo.trim()) e.orderNo = MSG.required('접수번호');
    if (!v.title.trim()) e.title = MSG.required('제목');
    if (!v.content.trim()) e.content = MSG.required('내용');
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const save = async () => {
    setConfirm(false);
    setBusy(true);
    const r = (await saveVoc(v)) as Res;
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return setMessage(r.message ?? null);
    }
    toast(MSG.saved);
    onClose();
    router.push(`/admin/voc/vocs/${(r.data as { id: number }).id}`);
  };
  return (
    <>
      <Modal
        open
        title="VOC 등록"
        onClose={onClose}
        form
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button variant="primary" loading={busy} onClick={() => validate() && setConfirm(true)}>
              저장
            </Button>
          </>
        }
      >
        {message ? <Alert tone="danger">{message}</Alert> : null}
        <div className="adm-form-grid">
          <Field label="접수번호" required error={errors.orderNo}>
            {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} value={v.orderNo} onChange={(e) => setV({ ...v, orderNo: e.target.value })} />}
          </Field>
          <Field label="접수 매체" required>
            {(id) => (
              <Select id={id} value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}>
                {opts('VOC_CHANNEL')}
              </Select>
            )}
          </Field>
          <Field label="VOC 유형" required>
            {(id) => (
              <Select id={id} value={v.vocType} onChange={(e) => setV({ ...v, vocType: e.target.value })}>
                {opts('VOC_TYPE')}
              </Select>
            )}
          </Field>
          <Field label="등급" help="높음이면 Alert로 표시됩니다.">
            {(id, d) => (
              <Select id={id} aria-describedby={d} value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })}>
                <option value="">선택 안 함</option>
                {opts('VOC_SEVERITY')}
              </Select>
            )}
          </Field>
          <Field label="대분류">
            {(id) => (
              <Select id={id} value={v.categoryL} onChange={(e) => setV({ ...v, categoryL: e.target.value, categoryM: '' })}>
                <option value="">선택 안 함</option>
                {opts('VOC_CATEGORY_L')}
              </Select>
            )}
          </Field>
          <Field label="중분류">
            {(id) => (
              <Select id={id} value={v.categoryM} onChange={(e) => setV({ ...v, categoryM: e.target.value })}>
                <option value="">선택 안 함</option>
                {opts('VOC_CATEGORY_M', (o) => !v.categoryL || o.value.startsWith(`${v.categoryL}_`) || o.value === 'ETC')}
              </Select>
            )}
          </Field>
          <div className="adm-span-2">
            <Field label="제목" required error={errors.title}>
              {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} maxLength={200} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />}
            </Field>
          </div>
          <div className="adm-span-2">
            <Field label="내용" required error={errors.content}>
              {(id, d, inv) => <Textarea id={id} aria-describedby={d} aria-invalid={inv} rows={4} maxLength={4000} value={v.content} onChange={(e) => setV({ ...v, content: e.target.value })} />}
            </Field>
          </div>
        </div>
      </Modal>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </>
  );
}
