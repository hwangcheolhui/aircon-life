'use client';
// A-CSL-060 이력 탭: 작업이력(n) | VOC이력(n) | 보상이력(n) (F-ADM-CSL-14). 작업이력 더블클릭 → 주문 요약 + 주문 상세(A-ORD-020) 이동
import { Button, Empty, Modal, StatusBadge, Tabs } from '@aircon/ui';
import Link from 'next/link';
import { useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { ConsoleData } from './screen';

type Tab = 'orders' | 'voc' | 'comp';

export function HistoryTabs({ data, codes }: { data: ConsoleData | null; codes: Record<string, Option[]> }) {
  const [tab, setTab] = useState<Tab>('orders');
  const [open, setOpen] = useState<ConsoleData['orders'][number] | null>(null);
  const orders = data?.orders ?? [];
  const claims = data?.claims ?? [];
  return (
    <section className="ac-card adm-csl-history" aria-label="고객 이력">
      <Tabs
        items={[
          { value: 'orders', label: `작업이력(${orders.length})` },
          { value: 'voc', label: `VOC이력(${claims.length})` },
          { value: 'comp', label: '보상이력(0)' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'orders' ? (
        orders.length === 0 ? (
          <Empty />
        ) : (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">상태</th>
                  <th scope="col">접수번호</th>
                  <th scope="col">처리코드</th>
                  <th scope="col">유형</th>
                  <th scope="col">약속일시</th>
                  <th scope="col">처리일</th>
                  <th scope="col">기기</th>
                  <th scope="col">기사</th>
                  <th scope="col" className="is-num">
                    금액
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} tabIndex={0} aria-label={`${o.orderNo} 상세 보기`} onDoubleClick={() => setOpen(o)} onKeyDown={(e) => e.key === 'Enter' && setOpen(o)}>
                    <td>
                      <StatusBadge code={o.status} audience="staff" />
                    </td>
                    <td className="ac-num">{o.orderNo}</td>
                    <td>{o.pendingReason ? labelOf(codes.PENDING_REASON, o.pendingReason) : '-'}</td>
                    <td>{labelOf(codes.ORDER_TYPE, o.orderType)}</td>
                    <td className="ac-num">{formatDateTime(o.promisedAt)}</td>
                    <td className="ac-num">{formatDateTime(o.completedAt) || '-'}</td>
                    <td>{o.devices || '-'}</td>
                    <td>{o.technicianName ?? '미지정'}</td>
                    <td className="is-num ac-num">{won(o.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'voc' ? (
        claims.length === 0 ? (
          <Empty />
        ) : (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">상담번호</th>
                  <th scope="col">상태</th>
                  <th scope="col">세부 유형</th>
                  <th scope="col">내용</th>
                  <th scope="col">접수일시</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id}>
                    <td className="ac-num">{c.consultNo}</td>
                    <td>{labelOf(codes.CONSULT_STATUS, c.status)}</td>
                    <td>{labelOf(codes.INQUIRY_SUB_TYPE, c.subType)}</td>
                    <td className="adm-csl-ellipsis">{c.content}</td>
                    <td className="ac-num">{formatDateTime(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <Empty />
      )}
      <Modal
        open={open !== null}
        title={open ? `접수 ${open.orderNo}` : ''}
        onClose={() => setOpen(null)}
        form
        actions={
          <>
            <Button variant="outline" onClick={() => setOpen(null)}>
              닫기
            </Button>
            {open ? (
              <Link className="ac-btn ac-btn--primary" href={`/admin/ord/orders/${open.id}`}>
                주문 상세에서 수정
              </Link>
            ) : null}
          </>
        }
      >
        {open ? (
          <dl className="adm-kv">
            <dt>상태</dt>
            <dd>
              <StatusBadge code={open.status} audience="staff" />
            </dd>
            <dt>채널</dt>
            <dd>{labelOf(codes.ORDER_CHANNEL, open.channel)}</dd>
            <dt>약속일시</dt>
            <dd className="ac-num">{formatDateTime(open.promisedAt)}</dd>
            <dt>기사</dt>
            <dd>{open.technicianName ?? '미지정'}</dd>
            <dt>기기</dt>
            <dd>{open.devices || '-'}</dd>
            <dt>금액</dt>
            <dd className="ac-num">{won(open.totalAmount)}</dd>
            <dt>요청사항</dt>
            <dd>{open.customerRequest ?? '-'}</dd>
            <dt>전달사항</dt>
            <dd>{open.internalNote ?? '-'}</dd>
          </dl>
        ) : null}
      </Modal>
    </section>
  );
}
