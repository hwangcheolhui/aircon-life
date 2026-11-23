'use client';
// A-ORD-010 주문 목록 (검색 영역 Enter = 조회, 그리드 더블클릭 = 상세, 03 §6.2)
import { Button, Empty, Field, Input, Select, StatusBadge } from '@aircon/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';

interface Row {
  id: number;
  orderNo: string;
  status: string;
  channel: string;
  promisedAt: Date | null;
  totalAmount: number;
  paymentStatus: string;
  createdAt: Date;
  branchName: string;
  customerNo: string;
  customerName: string;
  phoneMasked: string;
  roadAddress: string;
}

export function OrdersScreen(p: {
  rows: Row[];
  query: Record<string, string | undefined>;
  codes: Record<string, Option[]>;
  canExport: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState({ from: p.query.from ?? '', to: p.query.to ?? '', status: p.query.status ?? '', channel: p.query.channel ?? '', q: p.query.q ?? '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const open = (id: number) => router.push(`/admin/ord/orders/${id}`);
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">주문 목록</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/admin/ord/orders${qs ? `?${qs}` : ''}`);
        }}
      >
        <Field label="방문일(시작)">{(id) => <Input id={id} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
        <Field label="방문일(종료)">{(id) => <Input id={id} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        <Field label="상태">
          {(id) => (
            <Select id={id} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">전체</option>
              {p.codes.ORDER_STATUS?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="채널">
          {(id) => (
            <Select id={id} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
              <option value="">전체</option>
              {p.codes.ORDER_CHANNEL?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="접수번호·고객번호·전화번호">{(id) => <Input id={id} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />}</Field>
        <div className="ac-search-panel__actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setF({ from: '', to: '', status: '', channel: '', q: '' });
              router.push('/admin/ord/orders');
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
        <div className="ac-row">
          {p.canExport ? (
            <a className="ac-btn ac-btn--sm ac-btn--outline" href={`/admin/ord/orders/export${qs ? `?${qs}` : ''}`}>
              CSV 다운로드
            </a>
          ) : null}
          {p.canCreate ? (
            <Link className="ac-btn ac-btn--sm" href="/admin/ord/new">
              수동 주문 등록
            </Link>
          ) : null}
        </div>
      </div>
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">상태</th>
                <th scope="col">접수번호</th>
                <th scope="col">접수일시</th>
                <th scope="col">방문 예정</th>
                <th scope="col">거점</th>
                <th scope="col">고객</th>
                <th scope="col">연락처</th>
                <th scope="col">주소</th>
                <th scope="col">채널</th>
                <th scope="col" className="is-num">
                  금액
                </th>
                <th scope="col">결제</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} tabIndex={0} aria-label="주문 상세 열기" onDoubleClick={() => open(r.id)} onKeyDown={(e) => e.key === 'Enter' && open(r.id)}>
                  <td>
                    <StatusBadge code={r.status} audience="staff" />
                  </td>
                  <td className="ac-num">{r.orderNo}</td>
                  <td className="ac-num">{formatDateTime(r.createdAt)}</td>
                  <td className="ac-num">{formatDateTime(r.promisedAt)}</td>
                  <td>{r.branchName}</td>
                  <td>
                    <span className="ac-masked">{r.customerName}</span>
                  </td>
                  <td>
                    <span className="ac-masked ac-num">{r.phoneMasked}</span>
                  </td>
                  <td>{r.roadAddress}</td>
                  <td>{labelOf(p.codes.ORDER_CHANNEL, r.channel)}</td>
                  <td className="is-num ac-num">{won(r.totalAmount)}</td>
                  <td>{labelOf(p.codes.PAYMENT_STATUS, r.paymentStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
