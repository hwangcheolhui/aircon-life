'use client';
// T-PAY-010 현장 결제 · F-TEC-PAY-01·02: 금액 요약 → 고객 앱 결제 요청 / 결제 링크 문자 / 카드단말 / 계좌이체 / 현금 수금 입력, 못 받으면 미수로 남김.
// T-PAY-020 증빙 발행(하단 시트) · F-TEC-PAY-03: 현금·계좌이체 결제의 현금영수증.
// 금액 일치 검증은 domain checkCollect (서버도 같은 검증). 상태는 색 + 글자로 표시(05 §7).
import { checkCollect } from '@aircon/domain';
import { Alert, Button, Card, Field, Input, Sheet, Tag, Textarea, useToast } from '@aircon/ui';
import { Banknote, CreditCard, Landmark, Link2, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  collectJobPayment,
  markJobReceivable,
  requestJobPayment,
  requestJobTaxDoc,
} from '@/app/(tech)/tech/(flow)/actions';
import { formatDateTime, formatWon } from '@/customer/format';
import type { CodeMap } from '@/server/codes';
import type { TechPaymentState } from '@/server/payments';
import { TaxDocForm } from '@/shared/tax-doc-form';

type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };
type Method = 'ONSITE_CARD' | 'BANK_TRANSFER' | 'CASH';
const errOf = (r: Res, fallback: string) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? fallback;
const label = (codes: CodeMap, g: string, v: string) => codes[g]?.find((c) => c.value === v)?.label ?? v;
const SHEET = 'tec-sheet-overlay';

export function PayBoard({ s, codes }: { s: TechPaymentState; codes: CodeMap }) {
  const router = useRouter();
  const toast = useToast();
  const [method, setMethod] = useState<Method | null>(null);
  const [receivable, setReceivable] = useState(false);
  const [receiptFor, setReceiptFor] = useState<TechPaymentState['payments'][number] | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const open = s.status === 'WORK_DONE' && s.balance > 0;
  const approved = s.payments.filter((p) => p.status === 'APPROVED');

  const request = (channel: 'APP' | 'LINK') =>
    start(async () => {
      setError(null);
      const r = (await requestJobPayment({ orderNo: s.orderNo, channel })) as Res;
      if (!r.ok) return setError(errOf(r, '보내지 못했습니다.'));
      setRequested(
        channel === 'APP'
          ? '고객 앱(알림톡)으로 결제 요청을 보냈습니다.'
          : '고객에게 결제 링크 문자를 보냈습니다.',
      );
    });

  return (
    <>
      {s.status === 'COMPLETED' ? (
        <Alert tone="success">결제가 끝나 작업이 완료되었습니다. 정산 대상에 포함됩니다.</Alert>
      ) : null}
      {s.paymentStatus === 'RECEIVABLE' && open ? (
        <Alert tone="warning">미수로 남긴 작업입니다. 고객이 결제하면 자동으로 완료됩니다.</Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Card>
        <div className="tec-amount-row ac-body">
          <span>작업비</span>
          <span className="ac-num">{formatWon(s.laborAmount)}</span>
        </div>
        {s.extraAmount ? (
          <div className="tec-amount-row ac-body">
            <span>현장 추가(고객 동의)</span>
            <span className="ac-num">{formatWon(s.extraAmount)}</span>
          </div>
        ) : null}
        <div className="tec-amount-row ac-body">
          <span>청구 금액</span>
          <span className="ac-num">{formatWon(s.totalAmount)}</span>
        </div>
        {s.paidAmount ? (
          <div className="tec-amount-row ac-body">
            <span>결제 완료</span>
            <span className="ac-num">−{formatWon(s.paidAmount)}</span>
          </div>
        ) : null}
        <div className="tec-amount-row tec-amount-row--total ac-body-lg">
          <span>받을 금액</span>
          <span className="ac-num">{formatWon(s.balance)}</span>
        </div>
      </Card>

      {open ? (
        <section className="tec-section" aria-labelledby="pay-how">
          <h2 id="pay-how" className="ac-h3">
            결제 방법
          </h2>
          {requested ? (
            <Alert tone="success">
              {requested} 고객이 결제하면 자동으로 완료됩니다.{' '}
              <Button size="sm" variant="outline" onClick={() => router.refresh()}>
                결제 확인
              </Button>
            </Alert>
          ) : null}
          <div className="tec-pay-grid">
            <Button size="lg" block loading={pending} onClick={() => request('APP')}>
              <Smartphone aria-hidden /> 앱 결제 요청
            </Button>
            <Button size="lg" block loading={pending} onClick={() => request('LINK')}>
              <Link2 aria-hidden /> 결제 링크 문자
            </Button>
            <Button size="lg" block onClick={() => setMethod('ONSITE_CARD')}>
              <CreditCard aria-hidden /> 카드단말
            </Button>
            <Button size="lg" block onClick={() => setMethod('BANK_TRANSFER')}>
              <Landmark aria-hidden /> 계좌이체
            </Button>
            <Button size="lg" block onClick={() => setMethod('CASH')}>
              <Banknote aria-hidden /> 현금
            </Button>
          </div>
          {s.paymentStatus !== 'RECEIVABLE' ? (
            <Button variant="text" block onClick={() => setReceivable(true)}>
              지금 결제를 못 받아요 (미수로 남기기)
            </Button>
          ) : null}
        </section>
      ) : null}

      {approved.length ? (
        <section className="tec-section" aria-labelledby="pay-list">
          <h2 id="pay-list" className="ac-h3">
            결제 내역
          </h2>
          <ul className="ac-list">
            {approved.map((p) => {
              const doc = p.taxDocs.find((d) => d.issueStatus !== 'CANCELED');
              return (
                <li key={p.id} className="ac-list-item tec-pay-item">
                  <span>
                    <strong className="ac-body">{label(codes, 'PAYMENT_METHOD', p.method)}</strong>{' '}
                    <span className="ac-num">{formatWon(p.amount)}</span>
                    <br />
                    <span className="ac-caption ac-num">{formatDateTime(p.approvedAt ?? p.createdAt)}</span>
                  </span>
                  {doc ? (
                    <Tag
                      tone={
                        doc.issueStatus === 'ISSUED'
                          ? 'success'
                          : doc.issueStatus === 'FAILED'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {label(codes, 'TAX_DOC_TYPE', doc.docType)}{' '}
                      {label(codes, 'TAX_ISSUE_STATUS', doc.issueStatus)}
                    </Tag>
                  ) : p.taxDocTypes.length ? (
                    <Button size="sm" variant="outline" onClick={() => setReceiptFor(p)}>
                      현금영수증
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="ac-bottom-bar">
        <div className="ac-bottom-bar__price">
          <span className="ac-caption">받을 금액</span>
          <strong className="ac-num">{formatWon(s.balance)}</strong>
        </div>
        <Link href={`/tech/jobs/${s.orderNo}`} className="ac-btn ac-btn--dark ac-btn--lg">
          작업 상세로
        </Link>
      </div>

      {method ? (
        <Sheet
          title={label(codes, 'PAYMENT_METHOD', method)}
          onClose={() => setMethod(null)}
          overlayClassName={SHEET}
        >
          <CollectForm
            s={s}
            method={method}
            onDone={(completed) => {
              setMethod(null);
              toast(completed ? '결제를 받아 작업이 완료되었습니다.' : MSG_SAVED);
              router.refresh();
            }}
          />
        </Sheet>
      ) : null}
      {receivable ? (
        <Sheet title="미수로 남기기" onClose={() => setReceivable(false)} overlayClassName={SHEET}>
          <ReceivableForm
            orderNo={s.orderNo}
            balance={s.balance}
            onDone={() => {
              setReceivable(false);
              toast('미수로 남겼습니다. 운영자가 미수금 목록에서 관리합니다.');
              router.refresh();
            }}
          />
        </Sheet>
      ) : null}
      {receiptFor ? (
        <Sheet title="현금영수증 발행" onClose={() => setReceiptFor(null)} overlayClassName={SHEET}>
          <TaxDocForm
            payment={receiptFor}
            types={codes.TAX_DOC_TYPE ?? []}
            allowTaxInvoice={false}
            submit={(v) => requestJobTaxDoc({ ...v, orderNo: s.orderNo }) as Promise<Res>}
            onDone={() => {
              setReceiptFor(null);
              toast('현금영수증 발행을 요청했습니다.');
              router.refresh();
            }}
          />
        </Sheet>
      ) : null}
    </>
  );
}

const MSG_SAVED = '저장에 성공하였습니다.';

function CollectForm({
  s,
  method,
  onDone,
}: {
  s: TechPaymentState;
  method: Method;
  onDone: (completed: boolean) => void;
}) {
  const [amount, setAmount] = useState(method === 'ONSITE_CARD' ? String(s.balance) : '');
  const [approvalNo, setApprovalNo] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <p className="ac-body">
        받을 금액 <strong className="ac-num">{formatWon(s.balance)}</strong>
      </p>
      {method === 'CASH' || method === 'BANK_TRANSFER' ? (
        <p className="ac-caption">기사님이 직접 받은 돈은 주간 정산에서 지급액과 상계됩니다.</p>
      ) : null}
      <Field label="받은 금액" required error={errors.amount}>
        {(id, d, inv) => (
          <Input
            id={id}
            aria-describedby={d}
            aria-invalid={inv}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
          />
        )}
      </Field>
      {method === 'ONSITE_CARD' ? (
        <Field label="카드 승인번호" help="카드단말 영수증의 승인번호(선택)">
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              maxLength={30}
              value={approvalNo}
              onChange={(e) => setApprovalNo(e.target.value)}
            />
          )}
        </Field>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        block
        loading={pending}
        onClick={() =>
          start(async () => {
            setMessage(null);
            const e = checkCollect({
              method,
              amount: Number(amount || 0),
              balance: s.balance,
              orderStatus: s.status,
            });
            setErrors(e);
            if (Object.keys(e).length) return setMessage(e.form ?? null);
            const r = (await collectJobPayment({ orderNo: s.orderNo, method, amount, approvalNo })) as Res & {
              data?: { completed: boolean };
            };
            if (!r.ok) {
              setErrors(r.fieldErrors ?? {});
              return setMessage(r.message ?? null);
            }
            onDone(Boolean(r.data?.completed));
          })
        }
      >
        결제 받음
      </Button>
    </>
  );
}

function ReceivableForm({
  orderNo,
  balance,
  onDone,
}: {
  orderNo: string;
  balance: number;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <p className="ac-body">
        미수 금액 <strong className="ac-num">{formatWon(balance)}</strong>
      </p>
      <p className="ac-caption">미수 작업은 결제가 끝날 때까지 정산에서 빠집니다.</p>
      <Field label="미수 사유" required error={error ?? undefined}>
        {(id, d, inv) => (
          <Textarea
            id={id}
            aria-describedby={d}
            aria-invalid={inv}
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      <Button
        variant="primary"
        size="lg"
        block
        loading={pending}
        onClick={() =>
          start(async () => {
            if (!reason.trim()) return setError('미수 사유는 필수 입력값입니다.');
            const r = (await markJobReceivable({ orderNo, reason })) as Res;
            if (!r.ok) return setError(errOf(r, '저장하지 못했습니다.'));
            onDone();
          })
        }
      >
        미수로 저장
      </Button>
    </>
  );
}
