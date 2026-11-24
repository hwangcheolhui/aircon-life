'use client';
// A-PAY-010 결제 내역 / A-PAY-020 결제 실패 (검색 영역 Enter = 조회, 그리드 더블클릭 = 주문 상세, 금액 열 우측 정렬)
// 결제 내역: [대사] = PG 서버 재조회(F-ADM-PAY-01). 결제 실패: 사유 + [결제 링크 다시 보내기](F-ADM-PAY-02)
import { Alert, Button, Empty, Field, Input, Select, Tag, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { PaymentListRow } from '@/server/payments';
import { reconcile, resendLink } from '../actions';

const TONE: Record<string, 'success' | 'warning' | 'danger' | undefined> = {
  APPROVED: 'success',
  FAILED: 'danger',
  READY: 'warning',
};

export function PaymentsScreen(p: {
  rows: PaymentListRow[];
  query: { from: string; to: string; method: string | null; status: string | null; orderNo: string | null };
  codes: Record<string, Option[]>;
  mode: 'all' | 'failed';
  canResend: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const base = p.mode === 'all' ? '/admin/pay/payments' : '/admin/pay/failures';
  const [f, setF] = useState({
    from: p.query.from,
    to: p.query.to,
    method: p.query.method ?? '',
    status: p.mode === 'all' ? (p.query.status ?? '') : '',
    orderNo: p.query.orderNo ?? '',
  });
  const [checks, setChecks] = useState<Record<number, { match: boolean; message: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const approvedTotal = p.rows.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.amount, 0);
  const refundedTotal = p.rows.reduce((s, r) => s + r.refunded, 0);
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">{p.mode === 'all' ? '결제 내역' : '결제 실패'}</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`${base}${qs ? `?${qs}` : ''}`);
        }}
      >
        <Field label="결제일(시작)">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={f.from}
              onChange={(e) => setF({ ...f, from: e.target.value })}
            />
          )}
        </Field>
        <Field label="결제일(종료)">
          {(id) => (
            <Input id={id} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          )}
        </Field>
        <Field label="수단">
          {(id) => (
            <Select id={id} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              <option value="">전체</option>
              {p.codes.PAYMENT_METHOD?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {p.mode === 'all' ? (
          <Field label="상태">
            {(id) => (
              <Select id={id} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="">전체</option>
                {p.codes.PAYMENT_TX_STATUS?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <Field label="접수번호">
          {(id) => (
            <Input id={id} value={f.orderNo} onChange={(e) => setF({ ...f, orderNo: e.target.value })} />
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
          총 <strong className="ac-num">{p.rows.length.toLocaleString()}</strong>건
          {p.mode === 'all' ? (
            <>
              {' '}
              · 승인 합계 <strong className="ac-num">{won(approvedTotal)}</strong> · 환불{' '}
              <strong className="ac-num">{won(refundedTotal)}</strong>
            </>
          ) : null}
        </span>
      </div>
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">상태</th>
                <th scope="col">결제번호</th>
                <th scope="col">접수번호</th>
                <th scope="col">시점</th>
                <th scope="col">수단</th>
                <th scope="col" className="is-num">
                  금액
                </th>
                <th scope="col" className="is-num">
                  환불
                </th>
                <th scope="col">수금 기사</th>
                <th scope="col">일시</th>
                <th scope="col">{p.mode === 'all' ? 'PG 대사' : '실패 사유'}</th>
                {p.mode === 'failed' ? <th scope="col">처리</th> : null}
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} onDoubleClick={() => router.push(`/admin/ord/orders/${r.orderId}`)}>
                  <td>
                    <Tag tone={TONE[r.status]}>{labelOf(p.codes.PAYMENT_TX_STATUS, r.status)}</Tag>
                  </td>
                  <td className="ac-num">{r.paymentNo}</td>
                  <td className="ac-num">{r.orderNo}</td>
                  <td>{labelOf(p.codes.PAYMENT_STAGE, r.stage)}</td>
                  <td>{labelOf(p.codes.PAYMENT_METHOD, r.method)}</td>
                  <td className="is-num ac-num">{won(r.amount)}</td>
                  <td className="is-num ac-num">{r.refunded ? won(r.refunded) : ''}</td>
                  <td>{r.collectedBy}</td>
                  <td className="ac-num">{formatDateTime(new Date(r.approvedAt ?? r.createdAt))}</td>
                  {p.mode === 'all' ? (
                    <td>
                      {checks[r.id] ? (
                        <Tag tone={checks[r.id]!.match ? 'success' : 'danger'}>{checks[r.id]!.message}</Tag>
                      ) : r.pgProvider && r.status === 'APPROVED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const x = await reconcile(r.id);
                            if (!x.ok) return setError(x.message ?? '대사하지 못했습니다.');
                            setChecks((c) => ({
                              ...c,
                              [r.id]: x.data as { match: boolean; message: string },
                            }));
                          }}
                        >
                          대사
                        </Button>
                      ) : (
                        <span className="ac-caption">{r.pgProvider ? '' : '현장 결제'}</span>
                      )}
                    </td>
                  ) : (
                    <td>{r.failReason}</td>
                  )}
                  {p.mode === 'failed' ? (
                    <td>
                      {p.canResend && r.balance > 0 && !['CANCELED', 'COMPLETED'].includes(r.orderStatus) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            setError(null);
                            const x = await resendLink({ orderId: r.orderId });
                            if (!x.ok) return setError(x.message ?? '보내지 못했습니다.');
                            toast('결제 링크를 보냈습니다.');
                          }}
                        >
                          결제 링크 다시 보내기
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
