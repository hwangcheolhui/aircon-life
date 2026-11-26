'use client';
// A-STL-020 정산 회차 (F-ADM-STL-02·04): 그리드(금액 우측 정렬, 더블클릭 = 기사별 정산) + [회차 생성] + 행별 처리 버튼.
// 상태는 공통 코드 표시명 + 색 태그(색과 글자를 함께 표시).
import { Alert, Button, ConfirmModal, Empty, Field, Input, Modal, Select, Tag, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import type { BatchListRow } from '@/server/settlements';
import { actBatch, loadTransferSummary, saveBatch } from '../actions';

type Res = { ok: boolean; data?: unknown; message?: string; fieldErrors?: Record<string, string> };
const errOf = (r: Res, fallback: string) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? fallback;

export const BATCH_TONE: Record<string, 'primary' | 'success' | 'warning' | 'danger' | undefined> = {
  DRAFT: undefined,
  CALCULATED: 'primary',
  CONFIRMED: 'warning',
  PAID: 'success',
  CLOSED: undefined,
};

type Act = 'CALCULATE' | 'CONFIRM' | 'CLOSE';
const ACT_TEXT: Record<Act, { label: string; message: string; description: string }> = {
  CALCULATE: {
    label: '계산',
    message: '정산을 계산하시겠습니까?',
    description: '기간 안에 결제가 끝난 작업으로 기사별 정산서를 만들고, 기사에게 정산 확인 요청을 보냅니다.',
  },
  CONFIRM: {
    label: '확정',
    message: '정산 회차를 확정하시겠습니까?',
    description: '확정한 정산은 수정할 수 없고, 고칠 내용은 다음 회차 조정으로만 처리합니다. 기사가 아직 답하지 않은 정산서도 함께 확정됩니다.',
  },
  CLOSE: { label: '마감', message: '정산 회차를 마감하시겠습니까?', description: '지급이 끝난 회차를 마감합니다.' },
};

export function BatchesScreen(p: {
  rows: BatchListRow[];
  codes: Record<string, Option[]>;
  branches: Option[];
  lastWeekStart: string;
  canCreate: boolean;
  canCalc: boolean;
  canApprove: boolean;
  canExport: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [act, setAct] = useState<{ row: BatchListRow; act: Act } | null>(null);
  const [paying, setPaying] = useState<BatchListRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (row: BatchListRow, a: Act) => {
    setAct(null);
    setError(null);
    const r = (await actBatch({ batchId: row.id, action: a })) as Res;
    if (!r.ok) return setError(errOf(r, '처리하지 못했습니다.'));
    if (a === 'CALCULATE') {
      const d = r.data as { jobCount: number; techCount: number };
      toast(`계산했습니다. 작업 ${d.jobCount}건 · 기사 ${d.techCount}명`);
    } else toast(`${ACT_TEXT[a].label} 처리했습니다.`);
    router.refresh();
  };
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">정산 회차</h1>
        {p.canCreate ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            회차 생성
          </Button>
        ) : null}
      </div>
      <p className="ac-body-sm">
        매주 월요일 아침에 지난주(월~일) 회차가 자동으로 만들어지고 계산됩니다. 결제가 끝나지 않은 작업은 결제가 끝나는 주의 회차에 들어갑니다.
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">회차</th>
                <th scope="col">기간</th>
                <th scope="col">거점</th>
                <th scope="col">상태</th>
                <th scope="col" className="is-num">
                  기사
                </th>
                <th scope="col" className="is-num">
                  확인 대기
                </th>
                <th scope="col" className="is-num">
                  이의
                </th>
                <th scope="col" className="is-num">
                  실지급 합계
                </th>
                <th scope="col">지급 예정일</th>
                <th scope="col">처리</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} onDoubleClick={() => router.push(`/admin/stl/settlements?batchId=${r.id}`)}>
                  <td className="ac-num">{r.batchNo}</td>
                  <td className="ac-num">{`${r.periodStart} ~ ${r.periodEnd}`}</td>
                  <td>{r.branchName ?? '전체'}</td>
                  <td>
                    <Tag tone={BATCH_TONE[r.status]}>{labelOf(p.codes.SETTLEMENT_BATCH_STATUS, r.status)}</Tag>
                  </td>
                  <td className="is-num ac-num">{r.techCount}</td>
                  <td className="is-num ac-num">{r.pendingCount}</td>
                  <td className="is-num ac-num">{r.disputedCount ? <Tag tone="danger">{r.disputedCount}건</Tag> : 0}</td>
                  <td className="is-num ac-num">{won(r.totalNetPay)}</td>
                  <td className="ac-num">{r.scheduledPayDate ?? ''}</td>
                  <td>
                    <div className="ac-row">
                      <Button size="sm" variant="outline" onClick={() => router.push(`/admin/stl/settlements?batchId=${r.id}`)}>
                        기사별 정산
                      </Button>
                      {r.status === 'DRAFT' && p.canCalc ? (
                        <Button size="sm" variant="outline" onClick={() => setAct({ row: r, act: 'CALCULATE' })}>
                          계산
                        </Button>
                      ) : null}
                      {r.status === 'CALCULATED' && p.canApprove ? (
                        <Button size="sm" variant="outline" onClick={() => setAct({ row: r, act: 'CONFIRM' })}>
                          확정
                        </Button>
                      ) : null}
                      {(r.status === 'CONFIRMED' || r.status === 'PAID') && p.canExport ? (
                        <a className="ac-btn ac-btn--outline ac-btn--sm" href={`/admin/stl/batches/${r.id}/transfer-file`} download>
                          지급 파일
                        </a>
                      ) : null}
                      {r.status === 'CONFIRMED' && p.canApprove ? (
                        <Button size="sm" variant="outline" onClick={() => setPaying(r)}>
                          지급 완료
                        </Button>
                      ) : null}
                      {r.status === 'PAID' && p.canApprove ? (
                        <Button size="sm" variant="outline" onClick={() => setAct({ row: r, act: 'CLOSE' })}>
                          마감
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating ? (
        <CreateModal branches={p.branches} defaultStart={p.lastWeekStart} onClose={() => setCreating(false)} />
      ) : null}
      {act ? (
        <ConfirmModal
          open
          message={ACT_TEXT[act.act].message}
          description={`${act.row.batchNo} · ${ACT_TEXT[act.act].description}`}
          confirmLabel={ACT_TEXT[act.act].label}
          onCancel={() => setAct(null)}
          onConfirm={() => run(act.row, act.act)}
        />
      ) : null}
      {paying ? <PaidModal row={paying} onClose={() => setPaying(null)} /> : null}
    </div>
  );
}

function CreateModal({ branches, defaultStart, onClose }: { branches: Option[]; defaultStart: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      form
      title="정산 회차 생성"
      description="월요일을 고르면 그 주 월~일이 정산 기간이 됩니다. 끝난 주만 만들 수 있습니다."
      onClose={onClose}
      actions={
        <>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" type="submit" form="stl-batch-form" loading={busy}>
            생성
          </Button>
        </>
      }
    >
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      <form
        id="stl-batch-form"
        className="adm-form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const r = (await saveBatch(Object.fromEntries(new FormData(e.currentTarget)))) as Res;
          setBusy(false);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            setFormError(r.message ?? null);
            return;
          }
          toast(`${(r.data as { batchNo: string }).batchNo} 회차를 만들었습니다.`);
          onClose();
          router.refresh();
        }}
      >
        <Field label="정산 시작일(월요일)" required error={errors.periodStart}>
          {(id) => <Input id={id} name="periodStart" type="date" defaultValue={defaultStart} aria-invalid={Boolean(errors.periodStart)} />}
        </Field>
        <Field label="거점" error={errors.branchId} help="비우면 전체 거점">
          {(id) => (
            <Select id={id} name="branchId" defaultValue="">
              <option value="">{branches.length ? '전체' : '소속 거점'}</option>
              {branches.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Modal>
  );
}

type Summary = { transferCount: number; transferTotal: number; missingAccount: string[]; nonPositive: string[] };

function PaidModal({ row, onClose }: { row: BatchListRow; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadTransferSummary(row.id).then((r) => {
      const x = r as Res;
      if (x.ok) setSummary(x.data as Summary);
      else setError(errOf(x, '요약을 불러오지 못했습니다.'));
    });
  }, [row.id]);
  return (
    <Modal
      open
      form
      title="지급 완료 처리"
      description={`${row.batchNo} · 은행에서 지급 파일로 이체를 마친 뒤 누르세요. 기사에게 지급 완료 알림이 갑니다.`}
      onClose={onClose}
      actions={
        <>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" type="submit" form="stl-paid-form" loading={busy}>
            지급 완료
          </Button>
        </>
      }
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {summary ? (
        <dl className="adm-kv">
          <dt>이체 건수</dt>
          <dd className="ac-num">{summary.transferCount}건</dd>
          <dt>이체 합계</dt>
          <dd className="ac-num">{won(summary.transferTotal)}</dd>
          {summary.missingAccount.length ? (
            <>
              <dt>계좌 없음</dt>
              <dd className="adm-kv__wide">{summary.missingAccount.join(', ')} (지급 파일에서 빠짐, 따로 이체해 주세요)</dd>
            </>
          ) : null}
          {summary.nonPositive.length ? (
            <>
              <dt>이체 없음</dt>
              <dd className="adm-kv__wide">{summary.nonPositive.join(', ')} (실지급액 0원 이하, 다음 회차 조정으로 정리)</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      <form
        id="stl-paid-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ref = String(new FormData(e.currentTarget).get('transferRef') ?? '');
          const r = (await actBatch({ batchId: row.id, action: 'PAID', transferRef: ref })) as Res;
          setBusy(false);
          if (!r.ok) return setError(errOf(r, '처리하지 못했습니다.'));
          toast('지급 완료 처리했습니다.');
          onClose();
          router.refresh();
        }}
      >
        <Field label="이체 참조번호" help="은행 대량이체 접수번호 등(선택)">
          {(id) => <Input id={id} name="transferRef" maxLength={100} />}
        </Field>
      </form>
    </Modal>
  );
}
