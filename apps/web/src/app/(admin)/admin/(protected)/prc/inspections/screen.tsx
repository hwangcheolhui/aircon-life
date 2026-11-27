'use client';
// A-PRC-030 작업 결과 검수 (F-ADM-PRC-03): 검색 Enter = 조회, 그리드 더블클릭 = 검수, 사진은 /api/files 로 권한 확인 후 열람
import { Alert, Button, Empty, Field, Input, MSG, Modal, Select, Tag, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime, formatWon } from '@/customer/format';
import type { listInspections } from '@/server/inspections';
import { inspectAction } from './actions';

type Row = Awaited<ReturnType<typeof listInspections>>[number];
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };
const TONE: Record<string, 'success' | 'warning' | 'danger'> = { WAITING: 'warning', APPROVED: 'success', REJECTED: 'danger' };

export function InspectionScreen(p: { rows: Row[]; codes: Record<string, Option[]>; q: { status: string; from: string; to: string }; canApprove: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState(p.q);
  const [open, setOpen] = useState<Row | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setOpen(null);
    setNote('');
    setError(null);
  };
  const canAct = (r: Row) => p.canApprove && !r.inSettlement && r.inspectionStatus !== 'APPROVED';
  const submit = async (status: 'APPROVED' | 'REJECTED') => {
    if (!open) return;
    setBusy(true);
    const r = (await inspectAction({ workOrderId: open.workOrderId, status, note })) as Res;
    setBusy(false);
    if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '저장하지 못했습니다.');
    close();
    toast(MSG.saved);
    router.refresh();
  };
  return (
    <>
      <div className="adm-page-head">
        <h1 className="ac-h1">작업 결과 검수</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/admin/prc/inspections?${new URLSearchParams(q).toString()}`);
        }}
      >
        <Field label="검수 상태">
          {(id) => (
            <Select id={id} value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value })}>
              <option value="ALL">전체</option>
              {(p.codes.INSPECTION_STATUS ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="완료일(시작)">{(id) => <Input id={id} type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} />}</Field>
        <Field label="완료일(종료)">{(id) => <Input id={id} type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} />}</Field>
        <div className="ac-search-panel__actions">
          <Button type="submit" variant="primary" size="sm">
            조회
          </Button>
        </div>
      </form>
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap adm-gap-top">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">검수</th>
                <th scope="col">접수번호</th>
                <th scope="col">고객</th>
                <th scope="col">기사</th>
                <th scope="col">완료 시각</th>
                <th scope="col" className="is-num">
                  작업시간
                </th>
                <th scope="col" className="is-num">
                  사진
                </th>
                <th scope="col" className="is-num">
                  최종 금액
                </th>
                <th scope="col">처리</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.workOrderId} onDoubleClick={() => setOpen(r)}>
                  <td>
                    <Tag tone={TONE[r.inspectionStatus]}>{labelOf(p.codes.INSPECTION_STATUS, r.inspectionStatus)}</Tag>
                    {r.inSettlement ? <Tag>정산 반영</Tag> : null}
                  </td>
                  <td className="ac-num">{r.orderNo}</td>
                  <td>{r.customerName}</td>
                  <td>{r.techName}</td>
                  <td className="ac-num">{r.finishedAt ? formatDateTime(new Date(r.finishedAt)) : '-'}</td>
                  <td className="is-num ac-num">{r.workMinutes ? `${r.workMinutes}분` : '-'}</td>
                  <td className="is-num ac-num">{r.photos.length}장</td>
                  <td className="is-num ac-num">{formatWon(r.finalAmount ?? 0)}</td>
                  <td>
                    <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
                      {canAct(r) ? '검수' : '보기'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={open !== null}
        title="작업 결과 검수"
        description={open ? `${open.orderNo} · ${open.techName}` : undefined}
        onClose={close}
        form
        actions={
          <>
            <Button variant="outline" onClick={close}>
              닫기
            </Button>
            {open && canAct(open) ? (
              <>
                {open.inspectionStatus === 'WAITING' ? (
                  <Button variant="danger" loading={busy} onClick={() => submit('REJECTED')}>
                    반려(재작업)
                  </Button>
                ) : null}
                <Button variant="primary" loading={busy} onClick={() => submit('APPROVED')}>
                  승인
                </Button>
              </>
            ) : null}
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {open ? (
          <div className="ac-stack">
            {open.inSettlement ? <Alert tone="warning">이미 정산에 반영된 작업이라 검수 결과를 바꿀 수 없습니다.</Alert> : null}
            <div>
              <p className="ac-label">대수별 결과</p>
              {open.results.length ? (
                <ul className="adm-timeline">
                  {open.results.map((x) => (
                    <li key={x.unitNo} className="ac-body-sm">
                      {x.unitNo}번 · {labelOf(p.codes.WORK_RESULT, x.result)}
                      {x.conditionNote ? ` · ${x.conditionNote}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ac-body-sm">-</p>
              )}
            </div>
            <div>
              <p className="ac-label">사진</p>
              <div className="adm-prc-photos">
                {open.photos.length
                  ? open.photos.map((ph, i) => (
                      <a key={ph.id} href={`/api/files/${ph.fileId}`} target="_blank" rel="noreferrer">
                        {labelOf(p.codes.PHOTO_TYPE, ph.photoType)} {i + 1}
                      </a>
                    ))
                  : '-'}
              </div>
            </div>
            {open.workNote ? <p className="ac-body-sm adm-pre">작업 메모: {open.workNote}</p> : null}
            {open.inspectionNote ? <p className="ac-body-sm adm-pre">이전 검수 메모: {open.inspectionNote}</p> : null}
            {canAct(open) ? (
              <Field label="검수 메모" help="반려할 때는 재작업 사유를 꼭 적어 주세요. 주기사에게 알림이 갑니다.">
                {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
              </Field>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
