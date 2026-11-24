'use client';
// A-PAY-050 증빙 (F-ADM-PAY-05): 상태 탭, 그리드(금액 우측 정렬), 번호 .ac-masked + [보기](감사 로그), [발행]·[취소] 저장 전 확인.
import {
  Alert,
  Button,
  ConfirmModal,
  Empty,
  Field,
  Input,
  MSG,
  Masked,
  Modal,
  Tabs,
  Tag,
  useToast,
} from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { TaxDocRow } from '@/server/payments';
import { actTaxDoc, viewTaxIdentity } from '../actions';

type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };
const errOf = (r: Res, fallback: string) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? fallback;
const TONE: Record<string, 'success' | 'warning' | 'danger' | undefined> = {
  REQUESTED: 'warning',
  ISSUED: 'success',
  FAILED: 'danger',
};

export function ReceiptsScreen(p: {
  rows: TaxDocRow[];
  status: string | null;
  codes: Record<string, Option[]>;
  canIssue: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<TaxDocRow | null>(null);
  const [pending, setPending] = useState<{ row: TaxDocRow; action: 'ISSUE' | 'CANCEL' } | null>(null);
  const run = async (row: TaxDocRow, action: 'ISSUE' | 'CANCEL', issuedNo: string | null = null) => {
    setError(null);
    const r = (await actTaxDoc({ taxDocId: row.id, action, issuedNo })) as Res;
    if (!r.ok) return setError(errOf(r, '처리하지 못했습니다.'));
    toast(MSG.saved);
    router.refresh();
  };
  const tabs = [{ value: '', label: '전체' }, ...(p.codes.TAX_ISSUE_STATUS ?? [])];
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">증빙</h1>
      </div>
      <Tabs
        items={tabs}
        value={p.status ?? ''}
        onChange={(v) => router.push(v ? `/admin/pay/receipts?status=${v}` : '/admin/pay/receipts')}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap adm-gap-top">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">상태</th>
                <th scope="col">종류</th>
                <th scope="col">접수번호</th>
                <th scope="col">결제 수단</th>
                <th scope="col">발급 번호</th>
                <th scope="col" className="is-num">
                  공급가
                </th>
                <th scope="col" className="is-num">
                  부가세
                </th>
                <th scope="col" className="is-num">
                  합계
                </th>
                <th scope="col">승인번호</th>
                <th scope="col">신청</th>
                <th scope="col">처리</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Tag tone={TONE[r.issueStatus]}>{labelOf(p.codes.TAX_ISSUE_STATUS, r.issueStatus)}</Tag>
                    {r.failReason && r.issueStatus === 'FAILED' ? (
                      <span className="ac-caption"> {r.failReason}</span>
                    ) : null}
                  </td>
                  <td>{labelOf(p.codes.TAX_DOC_TYPE, r.docType)}</td>
                  <td className="ac-num">{r.orderNo}</td>
                  <td>{labelOf(p.codes.PAYMENT_METHOD, r.method)}</td>
                  <td className="ac-num">
                    <Masked
                      masked={r.identityMasked}
                      canView={p.canIssue}
                      onView={async () => {
                        const x = (await viewTaxIdentity(r.id)) as Res & { data?: string };
                        return x.ok ? (x.data ?? '') : null;
                      }}
                    />
                  </td>
                  <td className="is-num ac-num">{won(r.supplyAmount)}</td>
                  <td className="is-num ac-num">{won(r.vatAmount)}</td>
                  <td className="is-num ac-num">{won(r.totalAmount)}</td>
                  <td className="ac-num">{r.issuedNo ?? ''}</td>
                  <td className="ac-num">{formatDateTime(new Date(r.createdAt))}</td>
                  <td>
                    {p.canIssue ? (
                      <div className="ac-row">
                        {r.issueStatus === 'REQUESTED' || r.issueStatus === 'FAILED' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              r.docType === 'TAX_INVOICE'
                                ? setInvoice(r)
                                : setPending({ row: r, action: 'ISSUE' })
                            }
                          >
                            발행
                          </Button>
                        ) : null}
                        {r.issueStatus !== 'CANCELED' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPending({ row: r, action: 'CANCEL' })}
                          >
                            취소
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {invoice ? (
        <InvoiceModal
          row={invoice}
          onClose={() => setInvoice(null)}
          onSave={(no) => run(invoice, 'ISSUE', no)}
        />
      ) : null}
      <ConfirmModal
        open={pending !== null}
        message={pending?.action === 'CANCEL' ? '증빙을 취소하시겠습니까?' : MSG.confirmSave}
        confirmLabel={pending?.action === 'CANCEL' ? '증빙 취소' : '발행'}
        danger={pending?.action === 'CANCEL'}
        onConfirm={() => {
          const x = pending!;
          setPending(null);
          void run(x.row, x.action);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function InvoiceModal({
  row,
  onClose,
  onSave,
}: {
  row: TaxDocRow;
  onClose: () => void;
  onSave: (issuedNo: string) => Promise<void>;
}) {
  const [no, setNo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Modal
        open
        title="세금계산서 발행"
        description={`${row.orderNo} · 합계 ${won(row.totalAmount)} (공급가 ${won(row.supplyAmount)} + 부가세 ${won(row.vatAmount)}). 홈택스·회계 프로그램에서 발행한 뒤 국세청 승인번호를 입력하세요.`}
        onClose={onClose}
        form
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button
              variant="primary"
              onClick={() => (no.trim() ? setConfirm(true) : setError(MSG.required('국세청 승인번호')))}
            >
              저장
            </Button>
          </>
        }
      >
        <Field label="국세청 승인번호" required error={error ?? undefined}>
          {(id, d, inv) => (
            <Input
              id={id}
              aria-describedby={d}
              aria-invalid={inv}
              maxLength={50}
              value={no}
              onChange={(e) => setNo(e.target.value)}
            />
          )}
        </Field>
      </Modal>
      <ConfirmModal
        open={confirm}
        onConfirm={async () => {
          setConfirm(false);
          await onSave(no.trim());
          onClose();
        }}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
