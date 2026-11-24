'use client';
// A-PRC-050 미처리 대기열 (F-ADM-PRC-05): 사유 탭 + 그리드(경과 시간 우측 정렬, 장기 미처리 배지) + 행별 [재약속]·[취소].
// BR-031 고객부재 2회 연속이면 재약속 창에서 운영자 확인 표시와 확인 내용을 받아야 저장된다. 고객명은 마스킹(BR-100).
import { Alert, Button, Check, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, StatusBadge, Tabs, Tag, Textarea, useToast } from '@aircon/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { PendingRow } from '@/server/process-console';
import { cancelPendingOrder, saveReschedule } from '../actions';

type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };
const errOf = (r: Res, fallback: string) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? fallback;
const dt = (d: Date | string | null) => (d ? formatDateTime(new Date(d)) : '');
const ALL = '__ALL__';

export function PendingQueueScreen(p: {
  rows: PendingRow[];
  counts: Record<string, number>;
  reason: string | null;
  codes: Record<string, Option[]>;
  today: string;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const [rescheduleFor, setRescheduleFor] = useState<PendingRow | null>(null);
  const [cancelFor, setCancelFor] = useState<PendingRow | null>(null);
  const total = Object.values(p.counts).reduce((s, n) => s + n, 0);
  const tabs = [
    { value: ALL, label: `전체(${total})` },
    ...(p.codes.PENDING_REASON ?? []).map((c) => ({ value: c.value, label: `${c.label}(${p.counts[c.value] ?? 0})` })),
  ];
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">미처리 대기열</h1>
      </div>
      <Tabs<string>
        items={tabs}
        value={p.reason ?? ALL}
        onChange={(v) => router.push(v === ALL ? path : `${path}?reason=${encodeURIComponent(v)}`)}
      />
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          총 <strong className="ac-num">{p.rows.length.toLocaleString()}</strong>건 · 장기 미처리{' '}
          <strong className="ac-num">{p.rows.filter((r) => r.overdue48h).length.toLocaleString()}</strong>건
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
                <th scope="col">상태</th>
                <th scope="col">거점</th>
                <th scope="col">고객</th>
                <th scope="col">기사</th>
                <th scope="col">원래 약속</th>
                <th scope="col">미처리 사유</th>
                <th scope="col">메모</th>
                <th scope="col">미처리 일시</th>
                <th scope="col" className="is-num">
                  경과
                </th>
                <th scope="col">처리</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.orderId} onDoubleClick={() => router.push(`/admin/prc/console?order=${r.orderId}&no=${r.orderNo}`)}>
                  <td className="ac-num">{r.orderNo}</td>
                  <td>
                    <StatusBadge code="PENDING" audience="staff" overdue48h={r.overdue48h} />
                    {r.overdue48h ? <Tag tone="danger">장기 미처리</Tag> : null}
                    {r.operatorConfirm ? <Tag tone="warning">고객부재 {r.absentStreak}회 · 운영자 확인</Tag> : null}
                  </td>
                  <td>{r.branchName}</td>
                  <td>{r.customerName}</td>
                  <td>{r.mainTechName}</td>
                  <td className="ac-num">{dt(r.promisedAt)}</td>
                  <td>{labelOf(p.codes.PENDING_REASON, r.pendingReason)}</td>
                  <td>{r.memo ?? ''}</td>
                  <td className="ac-num">{dt(r.since)}</td>
                  <td className="is-num ac-num">{r.hours >= 24 ? `${Math.floor(r.hours / 24)}일 ${r.hours % 24}시간` : `${r.hours}시간`}</td>
                  <td>
                    {p.canUpdate ? (
                      <div className="ac-row">
                        <Button size="sm" variant="outline" onClick={() => setRescheduleFor(r)}>
                          재약속
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setCancelFor(r)}>
                          취소
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rescheduleFor ? <RescheduleModal row={rescheduleFor} today={p.today} onClose={() => setRescheduleFor(null)} /> : null}
      {cancelFor ? <CancelModal row={cancelFor} codes={p.codes} onClose={() => setCancelFor(null)} /> : null}
    </div>
  );
}

function RescheduleModal({ row, today, onClose }: { row: PendingRow; today: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [slotDate, setSlotDate] = useState('');
  const [slotHour, setSlotHour] = useState(row.requestedTimeFrom ? String(Number(row.requestedTimeFrom.slice(0, 2))) : '10');
  const [confirmed, setConfirmed] = useState(false);
  const [memo, setMemo] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const save = async () => {
    setConfirm(false);
    setError(null);
    const r = (await saveReschedule({
      orderId: row.orderId,
      slotDate,
      slotHour,
      operatorConfirmed: confirmed,
      confirmMemo: memo,
    })) as Res;
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return setError(errOf(r, '저장하지 못했습니다.'));
    }
    toast('재약속했습니다. 배정 보드의 새 날짜에 다시 올라갑니다.');
    onClose();
    router.refresh();
  };
  return (
    <>
      <Modal
        open
        title="재약속"
        description={`${row.orderNo} · ${row.mainTechName || '기사 미배정'} 기사 배정을 새 일정으로 옮기고 고객·기사에게 알립니다.`}
        onClose={onClose}
        form
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button variant="primary" onClick={() => (slotDate ? setConfirm(true) : setErrors({ slotDate: MSG.required('재약속 날짜') }))}>
              저장
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {row.operatorConfirm ? (
          <Alert tone="warning">고객부재가 {row.absentStreak}회 연속입니다. 고객과 통화해 방문 가능 여부를 확인한 뒤 재약속해 주세요.</Alert>
        ) : null}
        <div className="adm-form-grid">
          <Field label="재약속 날짜" required error={errors.slotDate}>
            {(id, desc, invalid) => (
              <Input id={id} type="date" min={today} aria-describedby={desc} aria-invalid={invalid} value={slotDate} onChange={(e) => setSlotDate(e.target.value)} />
            )}
          </Field>
          <Field label="방문 시각" required error={errors.slotHour}>
            {(id) => (
              <Select id={id} value={slotHour} onChange={(e) => setSlotHour(e.target.value)}>
                {Array.from({ length: 16 }, (_, i) => i + 6).map((h) => (
                  <option key={h} value={String(h)}>{`${String(h).padStart(2, '0')}:00`}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {row.operatorConfirm ? (
          <>
            <Check label="고객과 통화해 방문 가능을 확인했습니다" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            {errors.operatorConfirmed ? <p className="adm-text-danger ac-caption">{errors.operatorConfirmed}</p> : null}
          </>
        ) : null}
        <Field label={row.operatorConfirm ? '확인 내용' : '메모'} required={row.operatorConfirm} error={errors.confirmMemo}>
          {(id, desc, invalid) => (
            <Textarea id={id} rows={2} maxLength={300} aria-describedby={desc} aria-invalid={invalid} value={memo} onChange={(e) => setMemo(e.target.value)} />
          )}
        </Field>
      </Modal>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </>
  );
}

function CancelModal({ row, codes, onClose }: { row: PendingRow; codes: Record<string, Option[]>; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [reasonCode, setReasonCode] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const save = async () => {
    setConfirm(false);
    const r = (await cancelPendingOrder({ orderId: row.orderId, reasonCode, memo })) as Res;
    if (!r.ok) return setError(errOf(r, '취소하지 못했습니다.'));
    toast('주문을 취소했습니다.');
    onClose();
    router.refresh();
  };
  return (
    <>
      <Modal
        open
        title="미처리 주문 취소"
        description={`${row.orderNo} · 결제한 금액은 전액 환불하고 슬롯을 돌려놓습니다.`}
        onClose={onClose}
        form
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button variant="danger" onClick={() => (reasonCode ? setConfirm(true) : setError(MSG.required('취소 사유')))}>
              취소 처리
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="취소 사유" required>
          {(id) => (
            <Select id={id} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">선택</option>
              {(codes.CANCEL_REASON ?? []).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="메모">
          {(id) => <Textarea id={id} rows={2} maxLength={300} value={memo} onChange={(e) => setMemo(e.target.value)} />}
        </Field>
      </Modal>
      <ConfirmModal
        open={confirm}
        message="주문을 취소하시겠습니까?"
        confirmLabel="취소 처리"
        danger
        onConfirm={save}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
