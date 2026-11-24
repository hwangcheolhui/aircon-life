'use client';
// A-PRC-040 추가요금 승인 (F-ADM-PRC-04, BR-042): [승인 대기 | 처리 완료] 탭, 그리드 더블클릭 = 처리, 금액 열 우측 정렬
import { Alert, Button, Empty, Field, MSG, Modal, Tabs, Tag, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatDateTime, formatWon } from '@/customer/format';
import type { ExtraApprovalRow } from '@/server/extra-charges';
import { decideExtra } from './actions';

type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };
const errOf = (r: Res, fallback: string) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? fallback;

const STATUS: Record<string, { label: string; tone?: 'success' | 'warning' | 'danger' }> = {
  REQUESTED: { label: '승인 대기', tone: 'warning' },
  APPROVED: { label: '승인', tone: 'success' },
  REJECTED: { label: '반려', tone: 'danger' },
};

export function ExtraApprovalScreen(p: { rows: ExtraApprovalRow[]; tab: 'REQUESTED' | 'DONE'; canApprove: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<ExtraApprovalRow | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setOpen(null);
    setReason('');
    setError(null);
  };
  const submit = async (decision: 'APPROVE' | 'REJECT') => {
    if (!open) return;
    setBusy(true);
    const r = (await decideExtra({ chargeId: open.id, decision, reason })) as Res;
    setBusy(false);
    if (!r.ok) return setError(errOf(r, '저장하지 못했습니다.'));
    close();
    toast(MSG.saved);
    router.refresh();
  };
  const canAct = (r: ExtraApprovalRow) => p.canApprove && r.approvalStatus === 'REQUESTED';
  return (
    <>
      <div className="adm-page-head">
        <h1 className="ac-h1">추가요금 승인</h1>
      </div>
      <Tabs
        items={[
          { value: 'REQUESTED', label: '승인 대기' },
          { value: 'DONE', label: '처리 완료' },
        ]}
        value={p.tab}
        onChange={(v) => router.push(v === 'DONE' ? '/admin/prc/extra-charges?tab=done' : '/admin/prc/extra-charges')}
      />
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap adm-gap-top">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">상태</th>
                <th scope="col">접수번호</th>
                <th scope="col">항목</th>
                <th scope="col" className="is-num">
                  금액
                </th>
                <th scope="col">기사</th>
                <th scope="col">사유</th>
                <th scope="col">증빙</th>
                <th scope="col">등록 시각</th>
                <th scope="col">처리</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} onDoubleClick={() => canAct(r) && setOpen(r)}>
                  <td>
                    <Tag tone={STATUS[r.approvalStatus]?.tone}>{STATUS[r.approvalStatus]?.label ?? r.approvalStatus}</Tag>
                  </td>
                  <td className="ac-num">{r.orderNo}</td>
                  <td>{r.title}</td>
                  <td className="is-num ac-num">{formatWon(r.amount)}</td>
                  <td>{r.techName}</td>
                  <td>
                    {r.reason}
                    {r.rejectReason ? <span className="ac-caption"> (반려: {r.rejectReason})</span> : null}
                  </td>
                  <td>
                    {r.evidenceUrl ? (
                      <a href={r.evidenceUrl} target="_blank" rel="noreferrer">
                        사진 보기
                      </a>
                    ) : (
                      '없음'
                    )}
                  </td>
                  <td className="ac-num">{formatDateTime(new Date(r.createdAt))}</td>
                  <td>
                    {canAct(r) ? (
                      <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
                        처리
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={open !== null}
        title="추가요금 승인"
        description={open ? `${open.orderNo} · ${open.title} ${formatWon(open.amount)} · ${open.techName}` : undefined}
        onClose={close}
        form
        actions={
          <>
            <Button variant="outline" onClick={close}>
              닫기
            </Button>
            <Button variant="danger" loading={busy} onClick={() => submit('REJECT')}>
              반려
            </Button>
            <Button variant="primary" loading={busy} onClick={() => submit('APPROVE')}>
              승인
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <p className="ac-body">사유: {open?.reason}</p>
        <p className="ac-caption">승인하면 고객에게 동의 요청이 가고, 고객이 동의해야 청구됩니다.</p>
        <Field label="반려 사유" help="반려할 때만 입력합니다.">
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Modal>
    </>
  );
}
