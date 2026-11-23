'use client';
// A-ORD-020 주문 상세 화면
import { Alert, Button, ConfirmModal, Empty, Field, Input, MSG, Masked, Modal, Select, StatusBadge, Tabs, Textarea, useToast } from '@aircon/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { getOrderDetail } from '@/server/admin-orders';
import { cancelOrderAction, saveOrder, viewOrderPii } from '../actions';

type Detail = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;
const TABS = [
  { value: 'basic', label: '기본' },
  { value: 'items', label: '항목·금액' },
  { value: 'assign', label: '배정' },
  { value: 'result', label: '작업결과·사진' },
  { value: 'payment', label: '결제' },
  { value: 'activity', label: '활동내역' },
  { value: 'history', label: '상태이력' },
] as const;
type Tab = (typeof TABS)[number]['value'];

export function OrderDetailScreen({ d, codes, canUpdate, canReschedule }: { d: Detail; codes: Record<string, Option[]>; canUpdate: boolean; canReschedule: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('basic');
  type Pii = { name: string; phone: string; detailAddress: string };
  const [pii, setPii] = useState<Pii | null>(null);
  const [edit, setEdit] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [confirm, setConfirm] = useState<null | 'save' | 'cancel'>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const o = d.order;
  const L = (g: string, v: string | null | undefined) => labelOf(codes[g], v);
  const [form, setForm] = useState({
    slotDate: o.requestedDate ?? '',
    slotHour: o.requestedTimeFrom ? String(Number(o.requestedTimeFrom.slice(0, 2))) : '',
    customerRequest: o.customerRequest ?? '',
    internalNote: o.internalNote ?? '',
    detailAddress: '',
  });
  const [cancelForm, setCancelForm] = useState({ cancelReason: '', memo: '' });
  const closed = o.status === 'CANCELED' || o.status === 'COMPLETED';

  const loadPii = async () => {
    if (pii) return pii;
    const r = await viewOrderPii(o.id);
    if (!r.ok) {
      toast(r.message ?? '열람할 수 없습니다.');
      return null;
    }
    setPii(r.data as Pii);
    return r.data as Pii;
  };

  const run = async () => {
    const kind = confirm;
    setConfirm(null);
    setBusy(true);
    setError(null);
    const r =
      kind === 'save'
        ? await saveOrder({ orderId: o.id, ...form, slotDate: canReschedule ? form.slotDate : '', slotHour: canReschedule ? form.slotHour : '' })
        : await cancelOrderAction({ orderId: o.id, ...cancelForm });
    setBusy(false);
    if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '처리하지 못했습니다.');
    setEdit(false);
    setCancel(false);
    toast(kind === 'save' ? MSG.saved : '취소 처리했습니다.');
    router.refresh();
  };

  return (
    <div>
      <div className="adm-page-head">
        <div className="adm-detail-head">
          <Link href="/admin/ord/orders" className="ac-btn ac-btn--ghost ac-btn--sm">
            목록
          </Link>
          <StatusBadge code={o.status} audience="staff" />
          <h1 className="ac-h2 ac-num">{o.orderNo}</h1>
        </div>
        {canUpdate && !closed ? (
          <div className="adm-actions">
            <Button size="sm" onClick={() => (setError(null), setEdit(true))}>
              수정
            </Button>
            <Button size="sm" variant="outline" onClick={() => (setError(null), setCancel(true))}>
              취소
            </Button>
            <Button size="sm" variant="ghost" disabled title="단계 3 배정 콘솔에서 제공">
              재배정
            </Button>
          </div>
        ) : null}
      </div>
      <Tabs items={[...TABS]} value={tab} onChange={setTab} />
      <section className="adm-section" style={{ marginTop: 'var(--space-4)' }}>
        {tab === 'basic' ? (
          <dl className="adm-kv ac-body-sm">
            <dt>고객</dt>
            <dd>
              <Masked masked={d.customer.nameMasked} canView={canUpdate} onView={async () => (await loadPii())?.name ?? null} />{' '}
              <span className="ac-caption ac-num">{d.customer.customerNo}</span>
            </dd>
            <dt>연락처</dt>
            <dd>
              <Masked masked={d.customer.phoneMasked} canView={canUpdate} onView={async () => (await loadPii())?.phone ?? null} />
            </dd>
            <dt>방문 주소</dt>
            <dd>
              {d.address.roadAddress} <Masked masked="상세주소 ****" canView={canUpdate} onView={async () => (await loadPii())?.detailAddress ?? null} />
            </dd>
            <dt>주거·주차</dt>
            <dd>
              {L('HOUSING_TYPE', d.address.housingType)}
              {d.address.hasElevator ? ' · 엘리베이터' : ''}
              {d.address.parkingNote ? ` · ${d.address.parkingNote}` : ''}
            </dd>
            <dt>거점</dt>
            <dd>{d.branchName}</dd>
            <dt>채널·유형</dt>
            <dd>
              {L('ORDER_CHANNEL', o.channel)} · {L('ORDER_TYPE', o.orderType)}
            </dd>
            <dt>방문 예정</dt>
            <dd className="ac-num">
              {formatDateTime(o.promisedAt)} ({o.requestedTimeFrom?.slice(0, 5)}~{o.requestedTimeTo?.slice(0, 5)})
            </dd>
            <dt>방문 구분</dt>
            <dd>{L('VISIT_TYPE', o.visitType)}</dd>
            <dt>요청사항</dt>
            <dd>{o.customerRequest ?? ''}</dd>
            <dt>내부 메모</dt>
            <dd>{o.internalNote ?? ''}</dd>
            <dt>접수일시</dt>
            <dd className="ac-num">{formatDateTime(o.createdAt)}</dd>
            <dt>취소</dt>
            <dd>{o.canceledAt ? `${formatDateTime(o.canceledAt)} · ${L('CANCEL_REASON', o.cancelReason)}` : ''}</dd>
          </dl>
        ) : null}
        {tab === 'items' ? (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">구분</th>
                  <th scope="col">항목</th>
                  <th scope="col" className="is-num">
                    수량
                  </th>
                  <th scope="col" className="is-num">
                    단가
                  </th>
                  <th scope="col" className="is-num">
                    금액
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.id}>
                    <td>{L('QUOTE_ITEM_TYPE', i.itemType)}</td>
                    <td>{i.name}</td>
                    <td className="is-num ac-num">{i.quantity}</td>
                    <td className="is-num ac-num">{won(i.unitPrice)}</td>
                    <td className="is-num ac-num">{won(i.amount)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4}>
                    <strong>합계</strong> (상품 {won(o.subtotalAmount)} · 할인 {won(o.discountAmount)} · 할증 {won(o.surchargeAmount)} · 추가 {won(o.extraAmount)})
                  </td>
                  <td className="is-num ac-num">
                    <strong>{won(o.totalAmount)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
        {tab === 'assign' ? <Empty>기사 배정은 단계 3(배정 콘솔)에서 제공합니다.</Empty> : null}
        {tab === 'result' ? <Empty>작업 결과·사진은 단계 5(기사 작업 수행)에서 제공합니다.</Empty> : null}
        {tab === 'payment' ? (
          <>
            <p className="ac-body-sm">
              결제 상태 <strong>{L('PAYMENT_STATUS', o.paymentStatus)}</strong> · 결제 금액 <span className="ac-num">{won(o.paidAmount)}</span>
            </p>
            {d.payments.length === 0 ? (
              <Empty />
            ) : (
              <div className="ac-table-wrap">
                <table className="ac-table">
                  <thead>
                    <tr>
                      <th scope="col">결제번호</th>
                      <th scope="col">시점</th>
                      <th scope="col">수단</th>
                      <th scope="col">결과</th>
                      <th scope="col" className="is-num">
                        금액
                      </th>
                      <th scope="col">일시</th>
                      <th scope="col">실패 사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="ac-num">{p.paymentNo}</td>
                        <td>{L('PAYMENT_STAGE', p.paymentStage)}</td>
                        <td>{L('PAYMENT_METHOD', p.method)}</td>
                        <td>{L('PAYMENT_TX_STATUS', p.status)}</td>
                        <td className="is-num ac-num">{won(p.amount)}</td>
                        <td className="ac-num">{formatDateTime(p.approvedAt ?? p.createdAt)}</td>
                        <td>{p.failReason ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {d.refunds.length ? (
              <>
                <h3 className="ac-h3">환불</h3>
                <div className="ac-table-wrap">
                  <table className="ac-table">
                    <thead>
                      <tr>
                        <th scope="col">사유</th>
                        <th scope="col">상태</th>
                        <th scope="col" className="is-num">
                          환불액
                        </th>
                        <th scope="col" className="is-num">
                          취소 수수료
                        </th>
                        <th scope="col">일시</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.refunds.map((r) => (
                        <tr key={r.id}>
                          <td>{L('REFUND_REASON', r.reasonCode)}</td>
                          <td>{L('REFUND_STATUS', r.status)}</td>
                          <td className="is-num ac-num">{won(r.amount)}</td>
                          <td className="is-num ac-num">{won(r.cancelFee)}</td>
                          <td className="ac-num">{formatDateTime(r.refundedAt ?? r.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </>
        ) : null}
        {tab === 'activity' ? (
          d.requests.length === 0 ? (
            <Empty />
          ) : (
            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead>
                  <tr>
                    <th scope="col">요청</th>
                    <th scope="col">희망 일정</th>
                    <th scope="col">사유</th>
                    <th scope="col">상태</th>
                    <th scope="col">요청일시</th>
                    <th scope="col">처리일시</th>
                  </tr>
                </thead>
                <tbody>
                  {d.requests.map((r) => (
                    <tr key={r.id}>
                      <td>{L('CHANGE_REQUEST_TYPE', r.requestType)}</td>
                      <td className="ac-num">{r.requestedDate ? `${r.requestedDate} ${r.requestedTime?.slice(0, 5) ?? ''}` : ''}</td>
                      <td>{r.reason ?? ''}</td>
                      <td>{L('CHANGE_REQUEST_STATUS', r.status)}</td>
                      <td className="ac-num">{formatDateTime(r.createdAt)}</td>
                      <td className="ac-num">{formatDateTime(r.handledAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
        {tab === 'history' ? (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">일시</th>
                  <th scope="col">이전</th>
                  <th scope="col">변경</th>
                  <th scope="col">처리자</th>
                  <th scope="col">사유</th>
                  <th scope="col">메모</th>
                </tr>
              </thead>
              <tbody>
                {d.history.map((h) => (
                  <tr key={h.id}>
                    <td className="ac-num">{formatDateTime(h.createdAt)}</td>
                    <td>{h.fromStatus ? <StatusBadge code={h.fromStatus} audience="staff" /> : ''}</td>
                    <td>
                      <StatusBadge code={h.toStatus} audience="staff" />
                    </td>
                    <td>{L('ACTOR_TYPE', h.actorType)}</td>
                    <td>{h.reasonCode ? L('CANCEL_REASON', h.reasonCode) : ''}</td>
                    <td>{h.memo ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <Modal open={edit} form title="주문 수정" onClose={() => setEdit(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setConfirm('save');
          }}
          noValidate
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="adm-form-grid">
            <Field label="방문일" help={canReschedule ? '바꾸면 슬롯을 옮기고 고객에게 변경 알림을 보냅니다.' : '기사 출발 이후에는 바꿀 수 없습니다.'}>
              {(id, dsc) => <Input id={id} aria-describedby={dsc} type="date" value={form.slotDate} disabled={!canReschedule} onChange={(e) => setForm({ ...form, slotDate: e.target.value })} />}
            </Field>
            <Field label="시작 시각">
              {(id) => (
                <Select id={id} value={form.slotHour} disabled={!canReschedule} onChange={(e) => setForm({ ...form, slotHour: e.target.value })}>
                  {Array.from({ length: 16 }, (_, i) => i + 6).map((h) => (
                    <option key={h} value={String(h)}>{`${String(h).padStart(2, '0')}:00`}</option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="adm-span-2">
              <Field label="상세주소 변경" help="비우면 그대로 둡니다.">
                {(id, dsc) => <Input id={id} aria-describedby={dsc} value={form.detailAddress} maxLength={200} onChange={(e) => setForm({ ...form, detailAddress: e.target.value })} />}
              </Field>
            </div>
            <div className="adm-span-2">
              <Field label="요청사항">{(id) => <Textarea id={id} rows={2} maxLength={500} value={form.customerRequest} onChange={(e) => setForm({ ...form, customerRequest: e.target.value })} />}</Field>
            </div>
            <div className="adm-span-2">
              <Field label="내부 메모">{(id) => <Textarea id={id} rows={3} maxLength={1000} value={form.internalNote} onChange={(e) => setForm({ ...form, internalNote: e.target.value })} />}</Field>
            </div>
          </div>
          <div className="ac-modal__actions">
            <Button variant="ghost" onClick={() => setEdit(false)}>
              닫기
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              저장
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={cancel} form title="주문 취소" description={o.paidAmount > 0 ? `결제된 ${won(o.paidAmount)}을 전액 환불합니다.` : '결제 전 주문입니다.'} onClose={() => setCancel(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!cancelForm.cancelReason) return setError(MSG.required('취소 사유'));
            setConfirm('cancel');
          }}
          noValidate
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="취소 사유" required>
            {(id) => (
              <Select id={id} value={cancelForm.cancelReason} onChange={(e) => setCancelForm({ ...cancelForm, cancelReason: e.target.value })}>
                <option value="">선택</option>
                {codes.CANCEL_REASON?.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="메모">{(id) => <Textarea id={id} rows={2} maxLength={500} value={cancelForm.memo} onChange={(e) => setCancelForm({ ...cancelForm, memo: e.target.value })} />}</Field>
          <div className="ac-modal__actions">
            <Button variant="ghost" onClick={() => setCancel(false)}>
              닫기
            </Button>
            <Button type="submit" variant="danger" loading={busy}>
              취소 처리
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmModal open={confirm === 'save'} onConfirm={run} onCancel={() => setConfirm(null)} />
      <ConfirmModal open={confirm === 'cancel'} message="주문을 취소하시겠습니까?" confirmLabel="취소 처리" danger onConfirm={run} onCancel={() => setConfirm(null)} />
    </div>
  );
}
