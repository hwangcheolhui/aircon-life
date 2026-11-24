'use client';
// A-PAY-040 미수금 (F-ADM-PAY-04): 그리드(금액 우측 정렬) + 행별 [메모]·[결제 링크]·[입금 확인]. 고객명은 마스킹(BR-100).
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
import { type Option, won } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { ReceivableRow } from '@/server/payments';
import { confirmDeposit, saveReceivableMemo, sendReceivableLink } from '../actions';

type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };
const errOf = (r: Res, fallback: string) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? fallback;

export function ReceivablesScreen(p: {
  rows: ReceivableRow[];
  codes: Record<string, Option[]>;
  canMemo: boolean;
  canCollect: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [memoFor, setMemoFor] = useState<ReceivableRow | null>(null);
  const [depositFor, setDepositFor] = useState<ReceivableRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = p.rows.reduce((s, r) => s + r.balance, 0);
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">미수금</h1>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          총 <strong className="ac-num">{p.rows.length.toLocaleString()}</strong>건 · 미수 합계{' '}
          <strong className="ac-num">{won(total)}</strong>
        </span>
      </div>
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">접수번호</th>
                <th scope="col">고객</th>
                <th scope="col">기사</th>
                <th scope="col">작업 완료</th>
                <th scope="col" className="is-num">
                  경과일
                </th>
                <th scope="col" className="is-num">
                  청구
                </th>
                <th scope="col" className="is-num">
                  결제
                </th>
                <th scope="col" className="is-num">
                  미수
                </th>
                <th scope="col">최근 메모</th>
                <th scope="col">처리</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.orderId} onDoubleClick={() => router.push(`/admin/ord/orders/${r.orderId}`)}>
                  <td className="ac-num">{r.orderNo}</td>
                  <td>{r.customerName}</td>
                  <td>{r.techName}</td>
                  <td className="ac-num">{r.completedAt ? formatDateTime(new Date(r.completedAt)) : ''}</td>
                  <td className="is-num ac-num">
                    {r.days >= 7 ? <Tag tone="danger">{r.days}일</Tag> : `${r.days}일`}
                  </td>
                  <td className="is-num ac-num">{won(r.totalAmount)}</td>
                  <td className="is-num ac-num">{won(r.paidAmount)}</td>
                  <td className="is-num ac-num">{won(r.balance)}</td>
                  <td>{r.memos[0] ? r.memos[0].content : ''}</td>
                  <td>
                    <div className="ac-row">
                      {p.canMemo ? (
                        <Button size="sm" variant="outline" onClick={() => setMemoFor(r)}>
                          메모
                        </Button>
                      ) : null}
                      {p.canCollect ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              setError(null);
                              const x = (await sendReceivableLink({ orderId: r.orderId })) as Res;
                              if (!x.ok) return setError(errOf(x, '보내지 못했습니다.'));
                              toast('결제 링크를 보냈습니다.');
                            }}
                          >
                            결제 링크
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setDepositFor(r)}>
                            입금 확인
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {memoFor ? <MemoModal row={memoFor} onClose={() => setMemoFor(null)} /> : null}
      {depositFor ? (
        <DepositModal
          row={depositFor}
          methods={(p.codes.PAYMENT_METHOD ?? []).filter(
            (o) => o.value === 'BANK_TRANSFER' || o.value === 'CASH',
          )}
          onClose={() => setDepositFor(null)}
        />
      ) : null}
    </div>
  );
}

function MemoModal({ row, onClose }: { row: ReceivableRow; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const save = async () => {
    setConfirm(false);
    const r = (await saveReceivableMemo({ orderId: row.orderId, content })) as Res;
    if (!r.ok) return setError(errOf(r, '저장하지 못했습니다.'));
    toast(MSG.saved);
    onClose();
    router.refresh();
  };
  return (
    <>
      <Modal
        open
        title="[미수금] 메모"
        description={`${row.orderNo} · 미수 ${won(row.balance)}`}
        onClose={onClose}
        form
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button
              variant="primary"
              onClick={() => (content.trim() ? setConfirm(true) : setError(MSG.required('메모 내용')))}
            >
              저장
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {row.memos.length ? (
          <ul className="ac-list">
            {row.memos.map((m) => (
              <li key={m.id} className="ac-list-item">
                <div className="ac-list-item__body">
                  <span className="ac-body">{m.content}</span>
                  <span className="ac-caption ac-num">
                    {' '}
                    · {m.ownerType === 'TECHNICIAN' ? '기사' : '관리자'} ·{' '}
                    {formatDateTime(new Date(m.createdAt))}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <Field label="메모 내용" required>
          {(id, d) => (
            <Textarea
              id={id}
              aria-describedby={d}
              rows={3}
              maxLength={1000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          )}
        </Field>
      </Modal>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </>
  );
}

function DepositModal({
  row,
  methods,
  onClose,
}: {
  row: ReceivableRow;
  methods: Option[];
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [amount, setAmount] = useState(String(row.balance));
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const save = async () => {
    setConfirm(false);
    const r = (await confirmDeposit({ orderId: row.orderId, method, amount })) as Res;
    if (!r.ok) return setError(errOf(r, '저장하지 못했습니다.'));
    toast(MSG.saved);
    onClose();
    router.refresh();
  };
  return (
    <>
      <Modal
        open
        title="입금 확인"
        description={`${row.orderNo} · 미수 ${won(row.balance)}. 전액이 들어오면 주문이 완료되어 정산 대상이 됩니다.`}
        onClose={onClose}
        form
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button variant="primary" onClick={() => setConfirm(true)}>
              저장
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="결제 수단" required>
          {(id) => (
            <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)}>
              {methods.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="입금 금액" required>
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
      </Modal>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </>
  );
}
