'use client';
import { Alert, Button, ConfirmModal, Empty, Field, Select, StatusBadge, useToast } from '@aircon/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import { decideRequest } from './actions';

interface Row {
  id: number;
  orderId: number;
  orderNo: string;
  orderStatus: string;
  branchName: string;
  requestType: string;
  requestedDate: string | null;
  requestedTime: string | null;
  promisedAt: Date | null;
  reason: string | null;
  status: string;
  createdAt: Date;
  handledAt: Date | null;
  customerName: string;
}

export function RequestsScreen(p: { rows: Row[]; status: string; codes: Record<string, Option[]>; canUpdate: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState(p.status);
  const [target, setTarget] = useState<{ id: number; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const L = (g: string, v: string) => labelOf(p.codes[g], v);
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">변경·취소 요청</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/admin/ord/requests?status=${status}`);
        }}
      >
        <Field label="처리 상태">
          {(id) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ALL">전체</option>
              {p.codes.CHANGE_REQUEST_STATUS?.map((o) => (
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
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          총 <strong className="ac-num">{p.rows.length}</strong>건
        </span>
      </div>
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">요청일시</th>
                <th scope="col">접수번호</th>
                <th scope="col">주문 상태</th>
                <th scope="col">거점</th>
                <th scope="col">고객</th>
                <th scope="col">요청</th>
                <th scope="col">현재 일정</th>
                <th scope="col">희망 일정</th>
                <th scope="col">사유</th>
                <th scope="col">처리</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} tabIndex={0} onDoubleClick={() => router.push(`/admin/ord/orders/${r.orderId}`)} aria-label="주문 상세 열기">
                  <td className="ac-num">{formatDateTime(r.createdAt)}</td>
                  <td className="ac-num">
                    <Link href={`/admin/ord/orders/${r.orderId}`}>{r.orderNo}</Link>
                  </td>
                  <td>
                    <StatusBadge code={r.orderStatus} audience="staff" />
                  </td>
                  <td>{r.branchName}</td>
                  <td>
                    <span className="ac-masked">{r.customerName}</span>
                  </td>
                  <td>{L('CHANGE_REQUEST_TYPE', r.requestType)}</td>
                  <td className="ac-num">{formatDateTime(r.promisedAt)}</td>
                  <td className="ac-num">{r.requestedDate ? `${r.requestedDate} ${r.requestedTime?.slice(0, 5) ?? ''}` : ''}</td>
                  <td>{r.reason ?? ''}</td>
                  <td>
                    {r.status === 'REQUESTED' && p.canUpdate ? (
                      <div className="adm-actions">
                        <Button size="sm" variant="dark" onClick={() => setTarget({ id: r.id, decision: 'APPROVED' })}>
                          승인
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setTarget({ id: r.id, decision: 'REJECTED' })}>
                          반려
                        </Button>
                      </div>
                    ) : (
                      `${L('CHANGE_REQUEST_STATUS', r.status)} ${formatDateTime(r.handledAt)}`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmModal
        open={target !== null}
        message={target?.decision === 'APPROVED' ? '요청을 승인하시겠습니까?' : '요청을 반려하시겠습니까?'}
        confirmLabel={target?.decision === 'APPROVED' ? '승인' : '반려'}
        onCancel={() => setTarget(null)}
        onConfirm={async () => {
          const t = target!;
          setTarget(null);
          setError(null);
          const r = await decideRequest({ requestId: t.id, decision: t.decision });
          if (!r.ok) return setError(r.message ?? '처리하지 못했습니다.');
          toast('처리했습니다.');
          router.refresh();
        }}
      />
    </div>
  );
}
