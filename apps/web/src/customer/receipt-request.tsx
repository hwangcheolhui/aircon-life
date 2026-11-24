'use client';
// C-PAY-030 증빙 신청 (하단 시트, F-CUS-PAY-03): 승인된 결제별 현금영수증(소득공제·지출증빙)·세금계산서 신청과 진행 상태. 카드 결제는 카드 영수증 링크.
import { Sheet, Tag, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { requestReceipt } from '@/app/(customer)/(tabs)/orders/actions';
import type { CodeMap } from '@/server/codes';
import type { OrderPayment } from '@/server/payments';
import { TaxDocForm } from '@/shared/tax-doc-form';
import { formatDateTime, formatWon } from './format';

type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

export function ReceiptRequest({
  orderNo,
  payments,
  codes,
}: {
  orderNo: string;
  payments: OrderPayment[];
  codes: CodeMap;
}) {
  const router = useRouter();
  const toast = useToast();
  const [target, setTarget] = useState<OrderPayment | null>(null);
  const label = (g: string, v: string) => codes[g]?.find((c) => c.value === v)?.label ?? v;
  const approved = payments.filter((p) => p.status === 'APPROVED');
  if (!approved.length) return null;
  return (
    <section aria-labelledby="receipt-title">
      <h2 id="receipt-title" className="ac-h3">
        결제·증빙
      </h2>
      <ul className="ac-list">
        {approved.map((p) => {
          const doc = p.taxDocs.find((d) => d.issueStatus !== 'CANCELED');
          return (
            <li key={p.id} className="ac-list-item">
              <div className="ac-list-item__body">
                <span className="ac-body">
                  {label('PAYMENT_METHOD', p.method)} <span className="ac-num">{formatWon(p.amount)}</span>
                </span>
                <span className="ac-caption ac-num"> · {formatDateTime(p.approvedAt ?? p.createdAt)}</span>
              </div>
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
                  {label('TAX_DOC_TYPE', doc.docType)} {label('TAX_ISSUE_STATUS', doc.issueStatus)}
                </Tag>
              ) : p.taxDocTypes.length ? (
                <button
                  type="button"
                  className="ac-btn ac-btn--outline ac-btn--sm"
                  onClick={() => setTarget(p)}
                >
                  증빙 신청
                </button>
              ) : p.receiptUrl ? (
                <a
                  href={p.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ac-btn ac-btn--ghost ac-btn--sm"
                >
                  카드 영수증
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
      {target ? (
        <Sheet title="증빙 신청" onClose={() => setTarget(null)} overlayClassName="cus-sheet-overlay">
          <TaxDocForm
            payment={target}
            types={codes.TAX_DOC_TYPE ?? []}
            allowTaxInvoice
            submit={(v) => requestReceipt({ ...v, orderNo }) as Promise<Res>}
            onDone={() => {
              setTarget(null);
              toast('증빙을 신청했어요.');
              router.refresh();
            }}
          />
        </Sheet>
      ) : null}
    </section>
  );
}
