'use client';
// A-DSP-020 재배정·이관·자가 배정 요청(F-ADM-DSP-10, 단계 4-2). 경고(근무·시간 겹침·숙련·지역)는 확인 후 진행, 차단(BR-070·071·072)은 진행 불가.
import type { AssignIssue } from '@aircon/domain';
import {
  Alert,
  Button,
  Check,
  ConfirmModal,
  Empty,
  Field,
  Input,
  MSG,
  Modal,
  Select,
  StatusBadge,
  Tabs,
  Tag,
  Textarea,
  useToast,
} from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { listTransferRequests } from '@/server/dispatch';
import type { listSelfAssignRequests } from '@/server/self-assign';
import { decide, decideSelf, findOrder, reassign, techOptions } from './actions';

type Request = Awaited<ReturnType<typeof listTransferRequests>>[number];
type SelfRequest = Awaited<ReturnType<typeof listSelfAssignRequests>>[number];
type TechOpt = { id: number; name: string; grade: string; status: string };
type Found = {
  order: {
    id: number;
    orderNo: string;
    status: string;
    branchId: number;
    promisedAt: string | null;
    assignments: { id: number; role: string; status: string; technicianId: number | null; name: string }[];
  };
  techs: TechOpt[];
};
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown };

const TABS = [
  { value: 'transfer', label: '이관 요청' },
  { value: 'self', label: '자가 배정 요청' },
  { value: 'reassign', label: '재배정' },
] as const;
type Tab = (typeof TABS)[number]['value'];

const errOf = (r: Res, fallback: string) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? fallback;
const when = (iso: string | null) => (iso ? formatDateTime(new Date(iso)) : '');

/** 경고가 오면 보여 주고, 확인 체크 후 다시 보낸다 */
function useWarnFlow(onSaved: () => void) {
  const [warnings, setWarnings] = useState<AssignIssue[]>([]);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (send: (confirmWarnings: boolean) => Promise<Res>) => {
    setBusy(true);
    const r = await send(ack);
    setBusy(false);
    if (!r.ok) {
      setError(errOf(r, '저장하지 못했습니다.'));
      return;
    }
    const out = r.data as { saved: boolean; warnings?: AssignIssue[] } | undefined;
    if (out && !out.saved) {
      setError(null);
      setWarnings(out.warnings ?? []);
      setAck(false);
      return;
    }
    onSaved();
  };
  const reset = () => {
    setWarnings([]);
    setAck(false);
    setError(null);
  };
  const view = (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {warnings.length ? (
        <Alert tone="warning">
          <strong>확인이 필요합니다</strong>
          <ul className="adm-issue-list">
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {warnings.length ? (
        <Check
          label="경고 내용을 확인했고 그대로 진행합니다"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
      ) : null}
    </>
  );
  return { run, reset, view, busy, blocked: warnings.length > 0 && !ack, setError };
}

export function TransfersScreen(p: {
  requests: Request[];
  selfRequests: SelfRequest[];
  initialTab?: Tab;
  codes: Record<string, Option[]>;
  canUpdate: boolean;
}) {
  const [tab, setTab] = useState<Tab>(p.initialTab ?? 'transfer');
  const items = TABS.map((t) =>
    t.value === 'self' && p.selfRequests.length
      ? { ...t, label: `${t.label} ${p.selfRequests.length}` }
      : t.value === 'transfer' && p.requests.length
        ? { ...t, label: `${t.label} ${p.requests.length}` }
        : t,
  );
  const L = (g: string, v: string | null | undefined) => labelOf(p.codes[g], v);
  return (
    <>
      <div className="adm-page-head">
        <h1 className="ac-h1">재배정·이관</h1>
      </div>
      <Tabs items={items} value={tab} onChange={setTab} />
      {tab === 'transfer' ? (
        <TransferTab requests={p.requests} L={L} canUpdate={p.canUpdate} />
      ) : tab === 'self' ? (
        <SelfAssignTab requests={p.selfRequests} canUpdate={p.canUpdate} />
      ) : (
        <ReassignTab L={L} canUpdate={p.canUpdate} />
      )}
    </>
  );
}

function TransferTab(p: {
  requests: Request[];
  L: (g: string, v: string | null | undefined) => string;
  canUpdate: boolean;
}) {
  const [open, setOpen] = useState<Request | null>(null);
  if (p.requests.length === 0) return <Empty />;
  return (
    <div className="ac-table-wrap adm-gap-top">
      <table className="ac-table">
        <thead>
          <tr>
            <th scope="col">접수번호</th>
            <th scope="col">약속 일시</th>
            <th scope="col">요청 기사</th>
            <th scope="col">역할</th>
            <th scope="col">사유</th>
            <th scope="col">요청 시각</th>
            <th scope="col">처리</th>
          </tr>
        </thead>
        <tbody>
          {p.requests.map((r) => (
            <tr key={r.assignmentId} onDoubleClick={() => p.canUpdate && setOpen(r)}>
              <td className="ac-num">{r.orderNo}</td>
              <td className="ac-num">{when(r.promisedAt)}</td>
              <td>{r.techName}</td>
              <td>{p.L('ASSIGN_ROLE', r.role)}</td>
              <td className="adm-csl-ellipsis">{r.reason}</td>
              <td className="ac-num">{when(r.requestedAt)}</td>
              <td>
                {p.canUpdate ? (
                  <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
                    처리
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open ? <TransferModal req={open} L={p.L} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** F-ADM-DSP-10 자가 배정 요청: 코스 영향(넣을 위치·이동시간 증가)을 보고 승인/거절(사유 필수) */
function SelfAssignTab(p: { requests: SelfRequest[]; canUpdate: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<SelfRequest | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'APPROVE' | 'REJECT'>(null);
  const close = () => {
    setOpen(null);
    setReason('');
    setError(null);
  };
  const submit = async (decision: 'APPROVE' | 'REJECT') => {
    if (!open) return;
    setBusy(true);
    const r = (await decideSelf({ assignmentId: open.assignmentId, decision, reason })) as Res;
    setBusy(false);
    if (!r.ok) return setError(errOf(r, '저장하지 못했습니다.'));
    close();
    toast(MSG.saved);
    router.refresh();
  };
  if (p.requests.length === 0) return <Empty />;
  const zoneLabel = (z: SelfRequest['zone']) =>
    z === 'PRIMARY' ? '주 관할' : z === 'SECONDARY' ? '보조 관할' : '관할 밖';
  return (
    <div className="ac-table-wrap adm-gap-top">
      <table className="ac-table">
        <thead>
          <tr>
            <th scope="col">접수번호</th>
            <th scope="col">약속 일시</th>
            <th scope="col">주소</th>
            <th scope="col">요청 기사</th>
            <th scope="col">관할</th>
            <th scope="col">인원</th>
            <th scope="col">코스 영향</th>
            <th scope="col">요청 시각</th>
            <th scope="col">처리</th>
          </tr>
        </thead>
        <tbody>
          {p.requests.map((r) => (
            <tr key={r.assignmentId} onDoubleClick={() => p.canUpdate && setOpen(r)}>
              <td className="ac-num">{r.orderNo}</td>
              <td className="ac-num">{when(r.promisedAt)}</td>
              <td>{r.address}</td>
              <td>{r.techName}</td>
              <td>
                <Tag tone={r.zone === 'PRIMARY' ? 'primary' : 'warning'}>{zoneLabel(r.zone)}</Tag>
              </td>
              <td className="is-num ac-num">{r.requiredTechCount}명</td>
              <td>
                {r.insertion ? (
                  <>
                    <span className="ac-num">{r.insertion.position}</span>번째 · 이동 +
                    <span className="ac-num">{r.insertion.addedTravelMin}</span>분{' '}
                    {r.insertion.ok ? null : <Tag tone="danger">시간창 위반</Tag>}
                  </>
                ) : (
                  '계산 불가'
                )}
              </td>
              <td className="ac-num">{when(r.requestedAt)}</td>
              <td>
                {p.canUpdate ? (
                  <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
                    처리
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open ? (
        <Modal
          open
          form
          title="자가 배정 요청 처리"
          description={`${open.orderNo} · ${when(open.promisedAt)} · ${open.techName}`}
          onClose={close}
          actions={
            <>
              <Button
                variant="outline"
                loading={busy}
                onClick={() => {
                  if (!reason.trim()) return setError(MSG.required('거절 사유'));
                  setConfirm('REJECT');
                }}
              >
                거절
              </Button>
              <Button variant="primary" loading={busy} onClick={() => setConfirm('APPROVE')}>
                승인
              </Button>
            </>
          }
        >
          <div className="adm-csl-modal-body">
            {open.insertion && !open.insertion.ok ? (
              <Alert tone="warning">
                이 기사 코스에 넣으면 도착 허용 시간을 지키지 못하는 방문지가 생깁니다.
              </Alert>
            ) : null}
            <Field
              label="거절 사유"
              required
              help="거절할 때만 적습니다. 기사에게 사유와 함께 알림이 가고, 주문은 배정 대기로 남습니다."
              error={error ?? undefined}
            >
              {(id, desc, inv) => (
                <Textarea
                  id={id}
                  aria-describedby={desc}
                  aria-invalid={inv}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={200}
                />
              )}
            </Field>
          </div>
        </Modal>
      ) : null}
      <ConfirmModal
        open={confirm !== null}
        message={
          confirm === 'APPROVE' ? '자가 배정을 승인하시겠습니까?' : '자가 배정 요청을 거절하시겠습니까?'
        }
        description={
          confirm === 'APPROVE' ? '승인하면 배정이 확정되고 고객에게 기사 배정 안내가 나갑니다.' : undefined
        }
        confirmLabel={confirm === 'APPROVE' ? '승인' : '거절'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const d = confirm!;
          setConfirm(null);
          void submit(d);
        }}
      />
    </div>
  );
}

function TransferModal(p: {
  req: Request;
  L: (g: string, v: string | null | undefined) => string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [techs, setTechs] = useState<TechOpt[]>([]);
  const [toTech, setToTech] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<null | 'APPROVE' | 'REJECT'>(null);
  const flow = useWarnFlow(() => {
    p.onClose();
    toast(MSG.saved);
    router.refresh();
  });
  useEffect(() => {
    techOptions(p.req.branchId).then((r) => r.ok && setTechs(r.data as TechOpt[]));
  }, [p.req.branchId]);
  const submit = (decision: 'APPROVE' | 'REJECT') =>
    flow.run((confirmWarnings) =>
      decide({
        assignmentId: p.req.assignmentId,
        decision,
        toTechId: decision === 'APPROVE' ? toTech : '',
        reason,
        confirmWarnings: String(confirmWarnings),
      }),
    );
  return (
    <>
      <Modal
        open
        form
        title="이관 요청 처리"
        description={`${p.req.orderNo} · ${when(p.req.promisedAt)} · ${p.req.techName}(${p.L('ASSIGN_ROLE', p.req.role)})`}
        onClose={p.onClose}
        actions={
          <>
            <Button variant="outline" onClick={() => setConfirm('REJECT')} loading={flow.busy}>
              반려
            </Button>
            <Button
              variant="primary"
              loading={flow.busy}
              disabled={flow.blocked}
              onClick={() => {
                if (!toTech) {
                  flow.setError(MSG.required('이관받을 기사'));
                  return;
                }
                setConfirm('APPROVE');
              }}
            >
              승인
            </Button>
          </>
        }
      >
        <div className="adm-csl-modal-body">
          <Field label="기사가 적은 사유">{() => <p>{p.req.reason}</p>}</Field>
          <Field label="이관받을 기사" required help="승인할 때만 고릅니다.">
            {(id, desc, inv) => (
              <Select
                id={id}
                aria-describedby={desc}
                aria-invalid={inv}
                value={toTech}
                onChange={(e) => {
                  setToTech(e.target.value);
                  flow.reset();
                }}
              >
                <option value="">선택</option>
                {techs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {p.L('TECH_GRADE', t.grade)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="반려 사유" help="반려하면 원래 기사가 그대로 작업하고, 기사에게 반려 알림이 갑니다.">
            {(id, desc, inv) => (
              <Textarea
                id={id}
                aria-describedby={desc}
                aria-invalid={inv}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={200}
              />
            )}
          </Field>
          {flow.view}
        </div>
      </Modal>
      <ConfirmModal
        open={confirm !== null}
        message={confirm === 'APPROVE' ? '이관을 승인하시겠습니까?' : '이관 요청을 반려하시겠습니까?'}
        confirmLabel={confirm === 'APPROVE' ? '승인' : '반려'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const d = confirm!;
          setConfirm(null);
          void submit(d);
        }}
      />
    </>
  );
}

function ReassignTab(p: { L: (g: string, v: string | null | undefined) => string; canUpdate: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [orderNo, setOrderNo] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [toTech, setToTech] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const flow = useWarnFlow(() => {
    toast(MSG.saved);
    setFound(null);
    setToTech('');
    setReason('');
    router.refresh();
  });
  const search = async () => {
    flow.reset();
    const r = await findOrder(orderNo);
    if (!r.ok) {
      setFound(null);
      setSearchError(errOf(r, MSG.empty));
      return;
    }
    setSearchError(null);
    setFound(r.data as Found);
  };
  const main = found?.order.assignments.find((a) => a.role === 'MAIN');
  return (
    <div className="adm-gap-top">
      <form
        className="adm-csl-customer__row"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Field label="접수번호" error={searchError ?? undefined}>
          {(id, desc, inv) => (
            <Input
              id={id}
              aria-describedby={desc}
              aria-invalid={inv}
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
              placeholder="예: AC2611230001"
            />
          )}
        </Field>
        <Button type="submit" variant="dark">
          조회
        </Button>
      </form>

      {found ? (
        <div className="ac-card adm-gap-top adm-csl-modal-body">
          <div className="adm-detail-head">
            <StatusBadge code={found.order.status} audience="staff" />
            <span className="ac-num">{found.order.orderNo}</span>
            <span className="ac-num">{when(found.order.promisedAt)}</span>
          </div>
          {found.order.assignments.length ? (
            <ul className="adm-issue-list">
              {found.order.assignments.map((a) => (
                <li key={a.id}>
                  {p.L('ASSIGN_ROLE', a.role)}: {a.name} ({p.L('ASSIGN_STATUS', a.status)})
                </li>
              ))}
            </ul>
          ) : (
            <p>배정된 기사가 없습니다. 배정 보드에서 배정하세요.</p>
          )}
          {p.canUpdate && main && found.order.status === 'ASSIGNED' ? (
            <>
              <Field label="새 주기사" required>
                {(id, desc, inv) => (
                  <Select
                    id={id}
                    aria-describedby={desc}
                    aria-invalid={inv}
                    value={toTech}
                    onChange={(e) => {
                      setToTech(e.target.value);
                      flow.reset();
                    }}
                  >
                    <option value="">선택</option>
                    {found.techs
                      .filter((t) => t.id !== main.technicianId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {p.L('TECH_GRADE', t.grade)}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              <Field label="변경 사유" required>
                {(id, desc, inv) => (
                  <Textarea
                    id={id}
                    aria-describedby={desc}
                    aria-invalid={inv}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={200}
                  />
                )}
              </Field>
              {flow.view}
              <div className="adm-actions">
                <Button
                  variant="primary"
                  loading={flow.busy}
                  disabled={flow.blocked}
                  onClick={() => {
                    if (!toTech) return flow.setError(MSG.required('새 주기사'));
                    if (!reason.trim()) return flow.setError(MSG.required('변경 사유'));
                    setConfirming(true);
                  }}
                >
                  재배정
                </Button>
              </div>
            </>
          ) : found.order.status !== 'ASSIGNED' ? (
            <Alert tone="warning">배정완료 상태의 예약만 기사를 바꿀 수 있습니다.</Alert>
          ) : null}
        </div>
      ) : null}
      <ConfirmModal
        open={confirming}
        message="재배정하시겠습니까?"
        description="이전 기사와 새 기사에게 알림이 가고, 고객에게 기사 변경 안내가 나갑니다."
        confirmLabel="재배정"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void flow.run((confirmWarnings) =>
            reassign({
              orderId: found!.order.id,
              toTechId: toTech,
              reason,
              confirmWarnings: String(confirmWarnings),
            }),
          );
        }}
      />
    </div>
  );
}
