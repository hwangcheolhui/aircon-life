'use client';
// 증빙 신청 시트 내용 (F-CUS-PAY-03 C-PAY-030 · F-TEC-PAY-03 T-PAY-020): 현금·계좌이체 결제 1건 → 소득공제(휴대폰)/지출증빙(사업자번호)/세금계산서
// 번호 형식 검증은 domain checkTaxDocInput (서버도 같은 검증)
import { checkTaxDocInput } from '@aircon/domain';
import { Alert, Button, Field, Input } from '@aircon/ui';
import { useState, useTransition } from 'react';
import { formatWon } from '@/customer/format';

type Code = { value: string; label: string };
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

export function TaxDocForm({
  payment,
  types,
  allowTaxInvoice,
  submit,
  onDone,
}: {
  payment: { id: number; method: string; amount: number; taxDocTypes: string[] };
  types: Code[];
  /** 세금계산서는 고객(법인) 신청만. 기사 현장 증빙(T-PAY-020)은 현금영수증만 */
  allowTaxInvoice: boolean;
  submit: (v: { paymentId: number; docType: string; identityNo: string }) => Promise<Res>;
  onDone: () => void;
}) {
  const options = types.filter(
    (t) => payment.taxDocTypes.includes(t.value) && (allowTaxInvoice || t.value !== 'TAX_INVOICE'),
  );
  const [docType, setDocType] = useState(options[0]?.value ?? '');
  const [no, setNo] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const personal = docType === 'CASH_RECEIPT_INCOME';
  return (
    <>
      <p className="ac-body">
        결제 금액 <strong className="ac-num">{formatWon(payment.amount)}</strong>
      </p>
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <div className="ac-chip-row" role="group" aria-label="증빙 종류">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="ac-chip"
            aria-pressed={docType === o.value}
            onClick={() => setDocType(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <Field
        label={personal ? '휴대폰 번호' : '사업자등록번호'}
        required
        error={errors.identityNo}
        help={personal ? '현금영수증 카드 번호도 됩니다.' : '숫자 10자리'}
      >
        {(id, d, inv) => (
          <Input
            id={id}
            aria-describedby={d}
            aria-invalid={inv}
            inputMode="numeric"
            maxLength={30}
            value={no}
            onChange={(e) => setNo(e.target.value)}
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
            setMessage(null);
            const e = checkTaxDocInput({ docType, identityNo: no, method: payment.method });
            setErrors(e);
            if (Object.keys(e).length) return;
            const r = await submit({ paymentId: payment.id, docType, identityNo: no });
            if (!r.ok) {
              setErrors(r.fieldErrors ?? {});
              return setMessage(r.message ?? (r.fieldErrors ? null : '신청하지 못했습니다.'));
            }
            onDone();
          })
        }
      >
        증빙 신청
      </Button>
    </>
  );
}
