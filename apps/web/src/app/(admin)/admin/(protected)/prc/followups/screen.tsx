'use client';
// A-PRC-060 독촉·전달 현황 (F-ADM-PRC-08): 검색 Enter = 조회, 행 더블클릭 = 상세(회신 확인·종결)
import { Button, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, Tag, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { listFollowups } from '@/server/followups';
import { closeFollowupAction } from './actions';

type Row = Awaited<ReturnType<typeof listFollowups>>[number];
const tone = (s: string) => (s === 'REPLIED' ? ('success' as const) : s === 'SENT' ? ('warning' as const) : s === 'READ' ? ('primary' as const) : undefined);
const at = (d: Date | string | null) => (d ? formatDateTime(new Date(d)) : '-');

export function FollowupsScreen(p: { rows: Row[]; query: { from: string; to: string; status: string }; codes: Record<string, Option[]>; canUpdate: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState(p.query);
  const [open, setOpen] = useState<Row | null>(null);
  const [confirm, setConfirm] = useState(false);
  const close = async () => {
    if (!open) return;
    setConfirm(false);
    const r = await closeFollowupAction({ id: open.id });
    if (!r.ok) return toast(r.message ?? '처리하지 못했습니다.');
    toast(MSG.saved);
    setOpen(null);
    router.refresh();
  };
  const counts = { SENT: 0, READ: 0, REPLIED: 0 } as Record<string, number>;
  for (const r of p.rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">독촉·전달 현황</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/admin/prc/followups?${new URLSearchParams(f).toString()}`);
        }}
      >
        <Field label="보낸 날(시작)">{(id) => <Input id={id} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
        <Field label="보낸 날(종료)">{(id) => <Input id={id} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        <Field label="상태">
          {(id) => (
            <Select id={id} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">전체</option>
              {p.codes.FOLLOWUP_STATUS?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="ac-search-panel__actions">
          <Button type="submit" variant="primary" size="sm">
            조회
          </Button>
        </div>
      </form>
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          총 <strong className="ac-num">{p.rows.length}</strong>건 · 안 읽음 <strong className="ac-num">{counts.SENT}</strong> · 읽음 <strong className="ac-num">{counts.READ}</strong> · 회신{' '}
          <strong className="ac-num">{counts.REPLIED}</strong>
        </span>
        <span className="ac-caption">보내기는 상담 콘솔의 [독촉/전달] 탭에서 합니다.</span>
      </div>
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">상태</th>
                <th scope="col">구분</th>
                <th scope="col">접수번호</th>
                <th scope="col" className="is-num">
                  회차
                </th>
                <th scope="col">유형</th>
                <th scope="col">전달 내용</th>
                <th scope="col">받는 사람</th>
                <th scope="col">고객</th>
                <th scope="col">보낸 시각</th>
                <th scope="col">읽은 시각</th>
                <th scope="col">회신 시각</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} tabIndex={0} aria-label="상세 보기" onDoubleClick={() => setOpen(r)} onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}>
                  <td>
                    <Tag tone={tone(r.status)}>{labelOf(p.codes.FOLLOWUP_STATUS, r.status)}</Tag>
                  </td>
                  <td>{labelOf(p.codes.FOLLOWUP_TARGET, r.targetType)}</td>
                  <td className="ac-num">{r.orderNo ?? '-'}</td>
                  <td className="is-num ac-num">{r.followupCount}차</td>
                  <td>{labelOf(p.codes.FOLLOWUP_TYPE, r.followupType)}</td>
                  <td className="adm-csl-ellipsis">{r.message}</td>
                  <td>{r.receiver}</td>
                  <td className="ac-masked">{r.customerName}</td>
                  <td className="ac-num">{at(r.createdAt)}</td>
                  <td className="ac-num">{at(r.readAt)}</td>
                  <td className="ac-num">{at(r.repliedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={open !== null}
        title={open ? `${labelOf(p.codes.FOLLOWUP_TARGET, open.targetType)} ${open.followupCount}차` : ''}
        onClose={() => setOpen(null)}
        actions={
          <>
            <Button variant="outline" onClick={() => setOpen(null)}>
              닫기
            </Button>
            {open && p.canUpdate && open.status !== 'CLOSED' ? (
              <Button variant="primary" onClick={() => setConfirm(true)}>
                종결
              </Button>
            ) : null}
          </>
        }
      >
        {open ? (
          <dl className="adm-kv">
            <dt>상담번호</dt>
            <dd className="ac-num">{open.consultNo}</dd>
            <dt>원인</dt>
            <dd>{open.cause ? labelOf(p.codes.FOLLOWUP_CAUSE, open.cause) : '-'}</dd>
            <dt>전달 내용</dt>
            <dd className="adm-pre">{open.message}</dd>
            <dt>받는 사람</dt>
            <dd>{open.receiver}</dd>
            <dt>회신</dt>
            <dd className="adm-pre">{open.reply ?? '아직 회신이 없습니다.'}</dd>
          </dl>
        ) : null}
      </Modal>
      <ConfirmModal open={confirm} message="종결하시겠습니까?" onConfirm={close} onCancel={() => setConfirm(false)} />
    </div>
  );
}
