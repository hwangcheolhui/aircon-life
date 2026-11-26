'use client';
// A-STL-030 기사별 정산 (F-ADM-STL-03): 회차 선택, 기사별 그리드(금액 우측 정렬, 더블클릭 = 상세), 상세(건별 항목·상태 이력·이의 내용),
// [조정 추가](인센티브·공제·조정 ±, 사유 필수) · [이의 처리](처리 내용 필수 → 확정). 확정 이후는 수정하지 않고 다음 회차 조정(BR-084).
import { Alert, Button, Card, ConfirmModal, Empty, Field, Input, Modal, Select, Tag, Textarea, useToast } from '@aircon/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { SettlementHistoryRow, SettlementItemRow, SettlementListRow, getSettlementDetail } from '@/server/settlements';
import { saveAdjustment, saveDisputeResolve } from '../actions';
import { BATCH_TONE } from '../batches/screen';

type Res = { ok: boolean; data?: unknown; message?: string; fieldErrors?: Record<string, string> };
type Detail = Awaited<ReturnType<typeof getSettlementDetail>>;
type Batch = Detail['batch'];

export const SETTLEMENT_TONE: Record<string, 'primary' | 'success' | 'warning' | 'danger' | undefined> = {
  CALCULATED: 'primary',
  TECH_CONFIRMED: 'success',
  DISPUTED: 'danger',
  CONFIRMED: 'warning',
  PAID: 'success',
};

const signed = (n: number) => (n < 0 ? `−${won(-n)}` : won(n));

export function SettlementsScreen(p: {
  batches: Option[];
  batch: Batch | null;
  rows: SettlementListRow[];
  detail: Detail | null;
  techs: Option[];
  codes: Record<string, Option[]>;
  canAdjust: boolean;
  canResolve: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const [adjust, setAdjust] = useState<{ technicianId: string } | null>(null);
  const [resolving, setResolving] = useState(false);
  const c = p.codes;
  const go = (batchId: number | string, id?: number) => router.push(`${path}?batchId=${batchId}${id ? `&id=${id}` : ''}`);
  const sum = (k: keyof SettlementListRow) => p.rows.reduce((s, r) => s + (r[k] as number), 0);
  const batchAdjustable = p.batch?.status === 'CALCULATED';
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">기사별 정산 검토·조정</h1>
        {p.canAdjust && batchAdjustable ? (
          <Button variant="primary" onClick={() => setAdjust({ technicianId: p.detail ? String(p.detail.settlement.technicianId) : '' })}>
            조정 추가
          </Button>
        ) : null}
      </div>
      <div className="adm-toolbar">
        <Field label="정산 회차">
          {(id) => (
            <Select id={id} value={p.batch ? String(p.batch.id) : ''} onChange={(e) => e.target.value && go(e.target.value)}>
              {p.batches.length ? null : <option value="">회차 없음</option>}
              {p.batches.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {p.batch ? (
          <span className="ac-body-sm">
            <Tag tone={BATCH_TONE[p.batch.status]}>{labelOf(c.SETTLEMENT_BATCH_STATUS, p.batch.status)}</Tag> 기사{' '}
            <strong className="ac-num">{p.rows.length}</strong>명 · 실지급 합계 <strong className="ac-num">{won(sum('netPay'))}</strong>
          </span>
        ) : null}
      </div>
      {p.batch && p.batch.status !== 'DRAFT' && p.batch.status !== 'CALCULATED' ? (
        <Alert tone="warning">확정된 정산은 수정할 수 없습니다. 고칠 내용은 다음 회차에서 조정 항목으로 넣어 주세요.</Alert>
      ) : null}
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">상태</th>
                <th scope="col">기사</th>
                <th scope="col">등급</th>
                <th scope="col">계약</th>
                <th scope="col" className="is-num">
                  건수
                </th>
                <th scope="col" className="is-num">
                  담당 매출
                </th>
                <th scope="col" className="is-num">
                  기본 배분
                </th>
                <th scope="col" className="is-num">
                  추가요금
                </th>
                <th scope="col" className="is-num">
                  인센티브
                </th>
                <th scope="col" className="is-num">
                  공제
                </th>
                <th scope="col" className="is-num">
                  현장 수금
                </th>
                <th scope="col" className="is-num">
                  원천세
                </th>
                <th scope="col" className="is-num">
                  실지급
                </th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr
                  key={r.id}
                  aria-selected={p.detail?.settlement.id === r.id}
                  className={p.detail?.settlement.id === r.id ? 'is-selected' : undefined}
                  onDoubleClick={() => go(p.batch!.id, r.id)}
                >
                  <td>
                    <Tag tone={SETTLEMENT_TONE[r.status]}>{labelOf(c.SETTLEMENT_STATUS, r.status)}</Tag>
                  </td>
                  <td>
                    <button type="button" className="adm-link" onClick={() => go(p.batch!.id, r.id)}>
                      {r.techName}
                    </button>{' '}
                    <span className="ac-caption ac-num">{r.techCode}</span>
                  </td>
                  <td>{labelOf(c.TECH_GRADE, r.grade)}</td>
                  <td>{labelOf(c.CONTRACT_TYPE, r.contractType)}</td>
                  <td className="is-num ac-num">{r.jobCount}</td>
                  <td className="is-num ac-num">{won(r.grossSales)}</td>
                  <td className="is-num ac-num">{won(r.basePay)}</td>
                  <td className="is-num ac-num">{won(r.extraPay)}</td>
                  <td className="is-num ac-num">{won(r.incentive)}</td>
                  <td className="is-num ac-num">{won(r.deduction)}</td>
                  <td className="is-num ac-num">{won(r.cashCollected)}</td>
                  <td className="is-num ac-num">{won(r.withholdingTax)}</td>
                  <td className="is-num ac-num">{signed(r.netPay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.detail ? (
        <DetailCard
          d={p.detail}
          codes={c}
          canAdjust={p.canAdjust && p.detail.canAdjust}
          canResolve={p.canResolve && p.detail.settlement.status === 'DISPUTED' && p.detail.batch.status === 'CALCULATED'}
          onAdjust={() => setAdjust({ technicianId: String(p.detail!.settlement.technicianId) })}
          onResolve={() => setResolving(true)}
        />
      ) : null}
      {adjust && p.batch ? (
        <AdjustModal batch={p.batch} techs={p.techs} technicianId={adjust.technicianId} codes={c} onClose={() => setAdjust(null)} />
      ) : null}
      {resolving && p.detail ? <ResolveModal d={p.detail} onClose={() => setResolving(false)} /> : null}
    </div>
  );
}

function DetailCard(p: {
  d: Detail;
  codes: Record<string, Option[]>;
  canAdjust: boolean;
  canResolve: boolean;
  onAdjust: () => void;
  onResolve: () => void;
}) {
  const s = p.d.settlement;
  const c = p.codes;
  return (
    <Card className="adm-section">
      <div className="adm-detail-head">
        <h2 className="ac-h3">
          {p.d.techName} 정산서 <span className="ac-num">{p.d.batch.batchNo}</span>
        </h2>
        <Tag tone={SETTLEMENT_TONE[s.status]}>{labelOf(c.SETTLEMENT_STATUS, s.status)}</Tag>
        <div className="adm-actions">
          {p.canAdjust ? (
            <Button size="sm" variant="outline" onClick={p.onAdjust}>
              이 기사 조정 추가
            </Button>
          ) : null}
          {p.canResolve ? (
            <Button size="sm" variant="secondary" onClick={p.onResolve}>
              이의 처리
            </Button>
          ) : null}
        </div>
      </div>
      {s.disputeNote ? (
        <Alert tone={s.status === 'DISPUTED' ? 'danger' : 'warning'}>기사 이의 내용: {s.disputeNote}</Alert>
      ) : null}
      <dl className="adm-kv">
        <dt>과세 대상</dt>
        <dd className="ac-num">{signed(s.taxableAmount)}</dd>
        <dt>원천세</dt>
        <dd className="ac-num">{won(s.withholdingTax)}</dd>
        <dt>현장 수금 상계</dt>
        <dd className="ac-num">{won(s.cashCollected)}</dd>
        <dt>실지급액</dt>
        <dd className="ac-num">
          <strong>{signed(s.netPay)}</strong>
        </dd>
        {s.paidAt ? (
          <>
            <dt>지급 일시</dt>
            <dd className="ac-num">{formatDateTime(new Date(s.paidAt))}</dd>
            <dt>이체 참조</dt>
            <dd>{s.transferRef ?? ''}</dd>
          </>
        ) : null}
      </dl>
      <h3 className="ac-h4" style={{ marginTop: 'var(--space-5)' }}>
        건별 내역
      </h3>
      <ItemsTable items={p.d.items} codes={c} />
      <h3 className="ac-h4" style={{ marginTop: 'var(--space-5)' }}>
        상태 이력
      </h3>
      <HistoryList rows={p.d.history} codes={c} />
    </Card>
  );
}

function ItemsTable({ items, codes }: { items: SettlementItemRow[]; codes: Record<string, Option[]> }) {
  if (!items.length) return <Empty />;
  return (
    <div className="ac-table-wrap">
      <table className="ac-table">
        <thead>
          <tr>
            <th scope="col">구분</th>
            <th scope="col">접수번호</th>
            <th scope="col">역할</th>
            <th scope="col" className="is-num">
              매출
            </th>
            <th scope="col" className="is-num">
              배분율
            </th>
            <th scope="col" className="is-num">
              금액
            </th>
            <th scope="col">메모</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>{labelOf(codes.SETTLEMENT_ITEM_TYPE, i.itemType)}</td>
              <td className="ac-num">{i.orderNo ?? ''}</td>
              <td>{i.role ? labelOf(codes.ASSIGN_ROLE, i.role) : ''}</td>
              <td className="is-num ac-num">{i.salesAmount ? won(i.salesAmount) : ''}</td>
              <td className="is-num ac-num">{i.shareRate === null ? '' : `${Number(i.shareRate)}%`}</td>
              <td className="is-num ac-num">{signed(i.payAmount)}</td>
              <td>{i.memo ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryList({ rows, codes }: { rows: SettlementHistoryRow[]; codes: Record<string, Option[]> }) {
  if (!rows.length) return <Empty />;
  return (
    <ul className="ac-list">
      {rows.map((h) => (
        <li key={h.id} className="ac-list-item">
          <div className="ac-list-item__body">
            <span className="ac-caption ac-num">{formatDateTime(new Date(h.createdAt))}</span>{' '}
            <span className="ac-body-sm">
              {h.fromStatus ? `${labelOf(codes.SETTLEMENT_STATUS, h.fromStatus)} → ` : ''}
              {labelOf(codes.SETTLEMENT_STATUS, h.toStatus)} · {labelOf(codes.ACTOR_TYPE, h.actorType)}
              {h.memo ? ` · ${h.memo}` : ''}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AdjustModal(p: { batch: Batch; techs: Option[]; technicianId: string; codes: Record<string, Option[]>; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const types = (p.codes.SETTLEMENT_ITEM_TYPE ?? []).filter((o) => ['INCENTIVE', 'DEDUCTION', 'ADJUST'].includes(o.value));
  return (
    <>
      <Modal
        open
        form
        title="조정 추가"
        description={`${p.batch.batchNo} · 인센티브·공제는 금액만, 조정은 지난 회차 차액을 + / − 로 넣습니다. 사유는 기사 앱에도 보입니다.`}
        onClose={p.onClose}
        actions={
          <>
            <Button variant="outline" onClick={p.onClose}>
              취소
            </Button>
            <Button variant="primary" type="submit" form="stl-adjust-form">
              저장
            </Button>
          </>
        }
      >
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <form
          id="stl-adjust-form"
          className="adm-form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            setPending({ ...Object.fromEntries(new FormData(e.currentTarget)), batchId: p.batch.id });
          }}
        >
          <Field label="기사" required error={errors.technicianId}>
            {(id) => (
              <Select id={id} name="technicianId" defaultValue={p.technicianId} aria-invalid={Boolean(errors.technicianId)}>
                <option value="">선택</option>
                {p.techs.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="조정 구분" required error={errors.itemType}>
            {(id) => (
              <Select id={id} name="itemType" defaultValue="INCENTIVE" aria-invalid={Boolean(errors.itemType)}>
                {types.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="금액(원)" required error={errors.amount} help="조정에서 회수할 금액은 앞에 − 를 붙입니다.">
            {(id) => <Input id={id} name="amount" inputMode="numeric" aria-invalid={Boolean(errors.amount)} />}
          </Field>
          <Field label="사유" required error={errors.memo}>
            {(id) => <Textarea id={id} name="memo" maxLength={300} aria-invalid={Boolean(errors.memo)} />}
          </Field>
        </form>
      </Modal>
      <ConfirmModal
        open={Boolean(pending)}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const values = pending!;
          setPending(null);
          const r = (await saveAdjustment(values)) as Res;
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            setFormError(r.message ?? null);
            return;
          }
          toast('저장에 성공하였습니다.');
          p.onClose();
          router.push(`/admin/stl/settlements?batchId=${p.batch.id}&id=${(r.data as { settlementId: number }).settlementId}`);
          router.refresh();
        }}
      />
    </>
  );
}

function ResolveModal({ d, onClose }: { d: Detail; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Modal
        open
        form
        title="이의 처리"
        description="필요한 금액 조정은 먼저 [조정 추가]로 넣은 뒤 처리하세요. 처리하면 이 정산서는 확정되어 더 바꿀 수 없습니다."
        onClose={onClose}
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button variant="primary" onClick={() => (note.trim() ? setConfirming(true) : setError('처리 내용은 필수 입력값입니다.'))}>
              처리 완료
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {d.settlement.disputeNote ? <p className="ac-body-sm">기사 이의: {d.settlement.disputeNote}</p> : null}
        <Field label="처리 내용" required>
          {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} />}
        </Field>
      </Modal>
      <ConfirmModal
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false);
          const r = (await saveDisputeResolve({ settlementId: d.settlement.id, note })) as Res;
          if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '처리하지 못했습니다.');
          toast('저장에 성공하였습니다.');
          onClose();
          router.refresh();
        }}
      />
    </>
  );
}
