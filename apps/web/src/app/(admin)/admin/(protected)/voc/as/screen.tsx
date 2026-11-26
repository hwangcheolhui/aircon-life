'use client';
// A-VOC-030 AS 요청 (F-ADM-VOC-03): 상태 필터, 행 더블클릭 = 처리 창 [승인(보증 판정) | 반려 | 재방문 주문 생성 | 완료], 저장 전 확인
import { kstDate } from '@aircon/domain';
import { Alert, Button, Check, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, StatusBadge, Tag, Textarea, useToast } from '@aircon/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { listAs } from '@/server/voc';
import { createRevisit, decideAsAction, saveAs } from '../actions';

type Row = Awaited<ReturnType<typeof listAs>>[number];
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown };
const errOf = (r: Res) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '저장하지 못했습니다.';
const tone = (s: string) => (s === 'DONE' ? ('success' as const) : s === 'REJECTED' ? ('danger' as const) : s === 'SCHEDULED' ? ('primary' as const) : ('warning' as const));

export function AsScreen(p: { rows: Row[]; status: string | null; codes: Record<string, Option[]>; canCreate: boolean; canUpdate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<Row | null>(null);
  const [create, setCreate] = useState(false);
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">AS 요청</h1>
      </div>
      <div className="adm-toolbar">
        <div className="ac-segmented" role="group" aria-label="상태">
          {[{ value: '', label: '전체' }, ...(p.codes.AS_STATUS ?? [])].map((o) => (
            <button key={o.value} type="button" aria-pressed={(p.status ?? '') === o.value} onClick={() => router.push(o.value ? `/admin/voc/as?status=${o.value}` : '/admin/voc/as')}>
              {o.label}
            </button>
          ))}
        </div>
        {p.canCreate ? (
          <Button size="sm" onClick={() => setCreate(true)}>
            AS 등록
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
                <th scope="col">AS 번호</th>
                <th scope="col">원 접수번호</th>
                <th scope="col">사유</th>
                <th scope="col">보증</th>
                <th scope="col">고객</th>
                <th scope="col">귀책 기사</th>
                <th scope="col">재방문 주문</th>
                <th scope="col">요청일시</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} tabIndex={0} aria-label={`${r.asNo} 처리`} onDoubleClick={() => setOpen(r)} onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}>
                  <td>
                    <Tag tone={tone(r.status)}>{labelOf(p.codes.AS_STATUS, r.status)}</Tag>
                  </td>
                  <td className="ac-num">{r.asNo}</td>
                  <td className="ac-num">{r.orderNo}</td>
                  <td>{labelOf(p.codes.AS_REASON, r.reason)}</td>
                  <td>{r.isWarranty ? <Tag tone="success">무상(~{r.warrantyUntil})</Tag> : <Tag>유상</Tag>}</td>
                  <td className="ac-masked">{r.customerName}</td>
                  <td>{r.techName ?? '-'}</td>
                  <td className="ac-num">{r.newOrder ? r.newOrder.orderNo : '-'}</td>
                  <td className="ac-num">{formatDateTime(new Date(r.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open ? <AsModal row={open} codes={p.codes} canUpdate={p.canUpdate} onClose={() => setOpen(null)} /> : null}
      {create ? <AsCreateModal codes={p.codes} onClose={() => setCreate(false)} /> : null}
    </div>
  );
}

type Pending = { kind: 'ACCEPT' | 'REJECT' | 'DONE' } | { kind: 'REVISIT' };

function AsModal({ row, codes, canUpdate, onClose }: { row: Row; codes: Record<string, Option[]>; canUpdate: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [warranty, setWarranty] = useState(row.isWarranty);
  const [note, setNote] = useState(row.handleNote ?? '');
  const [slot, setSlot] = useState({ slotDate: kstDate(new Date(Date.now() + 86_400_000)), slotHour: '10' });
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    setBusy(true);
    const r = (p.kind === 'REVISIT' ? await createRevisit({ id: row.id, ...slot }) : await decideAsAction({ id: row.id, action: p.kind, isWarranty: warranty, note })) as Res;
    setBusy(false);
    if (!r.ok) return setError(errOf(r));
    toast(p.kind === 'REVISIT' ? `재방문 주문 ${(r.data as { orderNo: string }).orderNo}을(를) 만들었습니다. 배정 보드에서 기사를 배정하세요.` : MSG.saved);
    onClose();
    router.refresh();
  };
  const s = row.status;
  return (
    <>
      <Modal
        open
        title={`AS ${row.asNo}`}
        onClose={onClose}
        form
        actions={
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <dl className="adm-kv">
          <dt>상태</dt>
          <dd>
            <Tag tone={tone(s)}>{labelOf(codes.AS_STATUS, s)}</Tag>
          </dd>
          <dt>원 접수번호</dt>
          <dd className="ac-num">{row.orderNo}</dd>
          <dt>사유</dt>
          <dd>{labelOf(codes.AS_REASON, row.reason)}</dd>
          <dt>내용</dt>
          <dd className="adm-pre">{row.content ?? '-'}</dd>
          <dt>자동 보증 판정</dt>
          <dd>{row.warrantyUntil ? `작업 완료 후 보증기간 ${row.warrantyUntil}까지 → ${row.isWarranty ? '무상' : '유상'}` : '작업 완료일 없음'}</dd>
          <dt>사진</dt>
          <dd className="ac-row">
            {row.photoIds.length
              ? row.photoIds.map((id, i) => (
                  <a key={id} href={`/api/files/${id}`} target="_blank" rel="noreferrer">
                    사진 {i + 1}
                  </a>
                ))
              : '-'}
          </dd>
          {row.newOrder ? (
            <>
              <dt>재방문 주문</dt>
              <dd>
                <StatusBadge code={row.newOrder.status} audience="staff" />{' '}
                <span className="ac-num">
                  {row.newOrder.orderNo} · {formatDateTime(row.newOrder.promisedAt ? new Date(row.newOrder.promisedAt) : null)} · {won(row.newOrder.totalAmount)}
                </span>{' '}
                <Link href="/admin/dsp/board">배정 보드</Link>
              </dd>
            </>
          ) : null}
        </dl>
        {canUpdate && (s === 'REQUESTED' || s === 'ACCEPTED') ? (
          <div className="ac-stack adm-gap-top">
            {s === 'REQUESTED' ? <Check label="보증기간 내 무상 AS로 승인 (BR-050)" checked={warranty} onChange={(e) => setWarranty(e.target.checked)} /> : null}
            <Field label="처리 메모 / 반려 사유" help="반려하면 이 사유가 고객에게 안내됩니다.">
              {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <div className="ac-row">
              {s === 'REQUESTED' ? (
                <Button size="sm" loading={busy} onClick={() => setPending({ kind: 'ACCEPT' })}>
                  승인
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                loading={busy}
                onClick={() => {
                  if (!note.trim()) return setError(MSG.required('반려 사유'));
                  setError(null);
                  setPending({ kind: 'REJECT' });
                }}
              >
                반려
              </Button>
            </div>
          </div>
        ) : null}
        {canUpdate && s === 'ACCEPTED' ? (
          <div className="ac-stack adm-gap-top">
            <h3 className="ac-title">재방문 주문 생성 ({row.isWarranty ? '무상' : '유상'})</h3>
            <div className="ac-row">
              <Field label="방문일">{(id) => <Input id={id} type="date" value={slot.slotDate} onChange={(e) => setSlot({ ...slot, slotDate: e.target.value })} />}</Field>
              <Field label="방문 시각">
                {(id) => (
                  <Select id={id} value={slot.slotHour} onChange={(e) => setSlot({ ...slot, slotHour: e.target.value })}>
                    {Array.from({ length: 13 }, (_, i) => i + 8).map((h) => (
                      <option key={h} value={h}>
                        {h}시
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Button size="sm" variant="primary" loading={busy} onClick={() => setPending({ kind: 'REVISIT' })}>
              재방문 주문 생성
            </Button>
          </div>
        ) : null}
        {canUpdate && s === 'SCHEDULED' ? (
          <div className="ac-row adm-gap-top">
            <span className="ac-body-sm">재방문 작업이 끝나면 완료로 바꿀 수 있습니다. (매일 새벽 자동으로도 완료 처리)</span>
            <Button size="sm" loading={busy} onClick={() => setPending({ kind: 'DONE' })}>
              완료
            </Button>
          </div>
        ) : null}
      </Modal>
      <ConfirmModal
        open={pending !== null}
        message={pending?.kind === 'REVISIT' ? '재방문 주문을 만드시겠습니까?' : pending?.kind === 'REJECT' ? '반려하시겠습니까?' : undefined}
        onConfirm={run}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function AsCreateModal({ codes, onClose }: { codes: Record<string, Option[]>; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState({ orderNo: '', reason: 'DIRT_REMAIN', content: '' });
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setConfirm(false);
    setBusy(true);
    const r = (await saveAs(v)) as Res;
    setBusy(false);
    if (!r.ok) return setError(errOf(r));
    toast(MSG.saved);
    onClose();
    router.refresh();
  };
  return (
    <>
      <Modal
        open
        title="AS 등록"
        description="전화로 받은 AS 요청을 등록합니다. 보증 여부는 원 작업 완료일로 자동 판정됩니다."
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
              onClick={() => {
                if (!v.orderNo.trim()) return setError(MSG.required('접수번호'));
                setError(null);
                setConfirm(true);
              }}
            >
              저장
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="원 접수번호" required>
          {(id) => <Input id={id} value={v.orderNo} onChange={(e) => setV({ ...v, orderNo: e.target.value })} />}
        </Field>
        <Field label="AS 사유" required>
          {(id) => (
            <Select id={id} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })}>
              {codes.AS_REASON?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="내용">{(id) => <Textarea id={id} rows={3} maxLength={1000} value={v.content} onChange={(e) => setV({ ...v, content: e.target.value })} />}</Field>
      </Modal>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </>
  );
}
