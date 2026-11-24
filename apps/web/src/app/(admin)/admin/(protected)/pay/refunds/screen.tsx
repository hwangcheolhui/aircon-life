'use client';
// A-PAY-030 환불 처리 (F-ADM-PAY-03): 검색 Enter = 조회, 금액 열 우측 정렬, [환불 등록] 창 → 저장 전 확인(03 §6.2)
import { checkRefund } from '@aircon/domain';
import {
  Alert,
  Button,
  ConfirmModal,
  Empty,
  Field,
  Input,
  MSG,
  Modal,
  Select,
  Tag,
  Textarea,
  useToast,
} from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { RefundListRow, refundablePayments } from '@/server/payments';
import { findRefundable, saveRefund } from '../actions';

type Found = Awaited<ReturnType<typeof refundablePayments>>;

export function RefundsScreen(p: {
  rows: RefundListRow[];
  query: { from: string; to: string };
  codes: Record<string, Option[]>;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState(p.query);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">환불 처리</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/admin/pay/refunds?${new URLSearchParams(f).toString()}`);
        }}
      >
        <Field label="환불일(시작)">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={f.from}
              onChange={(e) => setF({ ...f, from: e.target.value })}
            />
          )}
        </Field>
        <Field label="환불일(종료)">
          {(id) => (
            <Input id={id} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
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
          총 <strong className="ac-num">{p.rows.length.toLocaleString()}</strong>건
        </span>
        {p.canCreate ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            환불 등록
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
                <th scope="col">접수번호</th>
                <th scope="col">결제번호</th>
                <th scope="col">수단</th>
                <th scope="col" className="is-num">
                  결제 금액
                </th>
                <th scope="col" className="is-num">
                  환불 금액
                </th>
                <th scope="col" className="is-num">
                  수수료
                </th>
                <th scope="col">사유</th>
                <th scope="col">방식</th>
                <th scope="col">환불일시</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Tag tone={r.status === 'DONE' ? 'success' : 'danger'}>
                      {labelOf(p.codes.REFUND_STATUS, r.status)}
                    </Tag>
                  </td>
                  <td className="ac-num">{r.orderNo}</td>
                  <td className="ac-num">{r.paymentNo}</td>
                  <td>{labelOf(p.codes.PAYMENT_METHOD, r.method)}</td>
                  <td className="is-num ac-num">{won(r.payAmount)}</td>
                  <td className="is-num ac-num">{won(r.amount)}</td>
                  <td className="is-num ac-num">{won(r.cancelFee)}</td>
                  <td>
                    {labelOf(p.codes.REFUND_REASON, r.reasonCode)}
                    {r.reasonDetail ? <span className="ac-caption"> ({r.reasonDetail})</span> : null}
                  </td>
                  <td>{r.manual ? '직접 환불(기록)' : 'PG 취소'}</td>
                  <td className="ac-num">{r.refundedAt ? formatDateTime(new Date(r.refundedAt)) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open ? <RefundModal codes={p.codes} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function RefundModal({ codes, onClose }: { codes: Record<string, Option[]>; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [orderNo, setOrderNo] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [v, setV] = useState({ paymentId: '', amount: '', fee: '0', reasonCode: '', reasonDetail: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const pay = found?.payments.find((x) => String(x.id) === v.paymentId);
  const lookup = async () => {
    setMessage(null);
    const r = await findRefundable(orderNo);
    if (!r.ok)
      return setMessage(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '조회하지 못했습니다.');
    const d = r.data as Found;
    setFound(d);
    const first = d.payments.find((x) => x.refundable > 0);
    setV((s) => ({
      ...s,
      paymentId: first ? String(first.id) : '',
      amount: first ? String(first.refundable) : '',
    }));
  };
  const validate = () => {
    const e = checkRefund({
      refundable: pay?.refundable ?? 0,
      amount: Number(v.amount || 0),
      fee: Number(v.fee || 0),
      reasonCode: v.reasonCode,
    });
    if (!pay) e.paymentId = MSG.required('결제');
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const save = async () => {
    setConfirm(false);
    setBusy(true);
    const r = await saveRefund(v);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return setMessage(r.message ?? null);
    }
    toast(MSG.saved);
    onClose();
    router.refresh();
  };
  return (
    <>
      <Modal
        open
        title="환불 등록"
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
              disabled={!pay}
              onClick={() => validate() && setConfirm(true)}
            >
              환불
            </Button>
          </>
        }
      >
        {message ? <Alert tone="danger">{message}</Alert> : null}
        <form
          className="ac-row"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup();
          }}
        >
          <Field label="접수번호">
            {(id) => <Input id={id} value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />}
          </Field>
          <Button type="submit" size="sm">
            조회
          </Button>
        </form>
        {found ? (
          found.payments.length ? (
            <>
              <Field label="결제" required error={errors.paymentId}>
                {(id) => (
                  <Select
                    id={id}
                    value={v.paymentId}
                    onChange={(e) => {
                      const x = found.payments.find((y) => String(y.id) === e.target.value);
                      setV({ ...v, paymentId: e.target.value, amount: x ? String(x.refundable) : '' });
                    }}
                  >
                    {found.payments.map((x) => (
                      <option key={x.id} value={x.id} disabled={x.refundable <= 0}>
                        {x.paymentNo} · {labelOf(codes.PAYMENT_METHOD, x.method)} {won(x.amount)} (환불 가능{' '}
                        {won(x.refundable)})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {pay && !pay.pg ? (
                <p className="ac-caption">현장 결제입니다. 고객에게 직접 돌려준 뒤 기록만 남깁니다.</p>
              ) : null}
              <Field label="환불 금액" required error={errors.amount}>
                {(id, d, inv) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    aria-invalid={inv}
                    inputMode="numeric"
                    value={v.amount}
                    onChange={(e) => setV({ ...v, amount: e.target.value.replace(/\D/g, '') })}
                  />
                )}
              </Field>
              <Field label="취소 수수료" error={errors.fee} help="고객에게 돌려주지 않고 남기는 금액">
                {(id, d, inv) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    aria-invalid={inv}
                    inputMode="numeric"
                    value={v.fee}
                    onChange={(e) => setV({ ...v, fee: e.target.value.replace(/\D/g, '') })}
                  />
                )}
              </Field>
              <Field label="환불 사유" required error={errors.reasonCode}>
                {(id, d, inv) => (
                  <Select
                    id={id}
                    aria-describedby={d}
                    aria-invalid={inv}
                    value={v.reasonCode}
                    onChange={(e) => setV({ ...v, reasonCode: e.target.value })}
                  >
                    <option value="">선택</option>
                    {codes.REFUND_REASON?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="상세 사유">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={2}
                    maxLength={300}
                    value={v.reasonDetail}
                    onChange={(e) => setV({ ...v, reasonDetail: e.target.value })}
                  />
                )}
              </Field>
            </>
          ) : (
            <Empty>환불할 수 있는 결제가 없습니다.</Empty>
          )
        ) : null}
      </Modal>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </>
  );
}
