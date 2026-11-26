'use client';
// A-CUS-030 파기 대상 관리 (F-ADM-CUS-05): 체크 선택 → [일괄 파기 승인] → 되돌릴 수 없다는 확인 창 → 파기
import { Alert, Button, ConfirmModal, Empty, Tag, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { listPurgeTargets } from '@/server/purge';
import { approvePurge } from './actions';

type Row = Awaited<ReturnType<typeof listPurgeTargets>>[number];

export function PurgeScreen({ rows, mode, codes, canApprove }: { rows: Row[]; mode: 'APPROVAL' | 'AUTO'; codes: Record<string, Option[]>; canApprove: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [sel, setSel] = useState<number[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const all = rows.length > 0 && sel.length === rows.length;
  const run = async () => {
    setConfirm(false);
    setBusy(true);
    const r = await approvePurge({ customerIds: sel });
    setBusy(false);
    if (!r.ok) return setError(r.message ?? '처리하지 못했습니다.');
    toast(`${(r.data as { purged: number }).purged}명의 개인정보를 파기했습니다.`);
    setSel([]);
    router.refresh();
  };
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">파기 대상 관리</h1>
      </div>
      <Alert tone="warning">
        {mode === 'APPROVAL'
          ? '승인 방식입니다. 매일 새벽 3시 배치는 대상만 추려 두고, 여기서 승인해야 파기됩니다.'
          : '자동 방식입니다. 매일 새벽 3시 배치가 예정일이 지난 고객을 바로 파기합니다.'}{' '}
        파기하면 이름·연락처·상세주소 등 개인을 알아볼 수 있는 정보가 지워지고 되돌릴 수 없습니다. 주문·결제 금액은 통계용으로 남습니다.
      </Alert>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          대상 <strong className="ac-num">{rows.length}</strong>명 · 선택 <strong className="ac-num">{sel.length}</strong>명
        </span>
        {canApprove ? (
          <Button variant="primary" size="sm" disabled={sel.length === 0} loading={busy} onClick={() => setConfirm(true)}>
            일괄 파기 승인
          </Button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">
                  <input type="checkbox" aria-label="전체 선택" checked={all} onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.id) : [])} />
                </th>
                <th scope="col">고객번호</th>
                <th scope="col">이름</th>
                <th scope="col">상태</th>
                <th scope="col">최근 작업일</th>
                <th scope="col">탈퇴일</th>
                <th scope="col">파기 예정일</th>
                <th scope="col" className="is-num">누적 주문</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${r.customerNo} 선택`}
                      checked={sel.includes(r.id)}
                      onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))}
                    />
                  </td>
                  <td className="ac-num">{r.customerNo}</td>
                  <td className="ac-masked">{r.name}</td>
                  <td>{r.status === 'WITHDRAWN' ? <Tag tone="warning">{labelOf(codes.CUSTOMER_STATUS, r.status)}</Tag> : labelOf(codes.CUSTOMER_STATUS, r.status)}</td>
                  <td className="ac-num">{r.lastServiceDate ?? '-'}</td>
                  <td className="ac-num">{r.withdrawnAt ? formatDateTime(new Date(r.withdrawnAt)) : '-'}</td>
                  <td className="ac-num">{r.purgeDueDate}</td>
                  <td className="is-num ac-num">{r.totalOrderCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmModal
        open={confirm}
        message={`${sel.length}명의 개인정보를 파기하시겠습니까?`}
        description="파기한 정보는 되돌릴 수 없습니다."
        confirmLabel="파기"
        danger
        onConfirm={run}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
