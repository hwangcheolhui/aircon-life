'use client';
// A-DSP-010 배정 보드. 카드를 기사 줄에 끌어 놓거나 [배정] 버튼으로 배정 창을 연다.
// 배정 창은 고른 기사마다 근무·시간 겹침·숙련·지역 경고와 BR-070·071·072 차단을 미리 보여 준다.
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
  Tag,
  Textarea,
  useToast,
} from '@aircon/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import type { loadBoard } from '@/server/dispatch';
import { assign, checkAssign, unassign } from './actions';

type Board = NonNullable<Awaited<ReturnType<typeof loadBoard>>>;
type CardT = Board['cards'][number];
type TechT = Board['techs'][number];

const WAITING = ['RECEIVED', 'ASSIGN_WAIT'];

/** ISO → 한국 시각 HH:MM */
const hm = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '시간 미정';
const kstHour = (iso: string) => Number(hm(iso).slice(0, 2));

export function BoardScreen(p: {
  branches: Option[];
  branchId: string;
  date: string;
  hours: number[];
  board: Board | null;
  codes: Record<string, Option[]>;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [assigning, setAssigning] = useState<{ card: CardT; mainTechId: number | null } | null>(null);
  const [unassigning, setUnassigning] = useState<CardT | null>(null);
  const [dropOn, setDropOn] = useState<number | null>(null);
  const go = (q: { branchId?: string; date?: string }) => {
    const sp = new URLSearchParams({ branchId: q.branchId ?? p.branchId, date: q.date ?? p.date });
    router.push(`/admin/dsp/board?${sp.toString()}`);
  };
  const L = (g: string, v: string | null | undefined) => labelOf(p.codes[g], v);
  const b = p.board;
  const waiting = b?.cards.filter((c) => WAITING.includes(c.status)) ?? [];
  const placed = b?.cards.filter((c) => !WAITING.includes(c.status) && c.assignments.length) ?? [];
  const cardById = (id: number) => b?.cards.find((c) => c.id === id) ?? null;

  return (
    <>
      <div className="adm-page-head">
        <h1 className="ac-h1">배정 보드</h1>
        <div className="adm-actions">
          {p.branches.length > 1 ? (
            <Select aria-label="거점" value={p.branchId} onChange={(e) => go({ branchId: e.target.value })}>
              {p.branches.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : null}
          <Input
            type="date"
            aria-label="날짜"
            value={p.date}
            onChange={(e) => e.target.value && go({ date: e.target.value })}
          />
        </div>
      </div>

      {!b ? (
        <Empty>볼 수 있는 거점이 없습니다.</Empty>
      ) : (
        <>
          <div className="adm-board-summary">
            <Tag>
              배정대기 <span className="ac-num">{b.summary.waiting}</span>건
            </Tag>
            <Tag tone={b.summary.urgent ? 'danger' : undefined}>
              약속 {b.alertHours}시간 이내 미지정 <span className="ac-num">{b.summary.urgent}</span>건
            </Tag>
            <Tag>
              미처리 <span className="ac-num">{b.summary.pending}</span>건
            </Tag>
            {b.summary.selfRequested ? (
              <Link href="/admin/dsp/transfers?tab=self" className="ac-btn ac-btn--text ac-btn--sm">
                자가 배정 승인 대기 <span className="ac-num">{b.summary.selfRequested}</span>건
              </Link>
            ) : null}
          </div>
          {b.summary.urgent ? (
            <Alert tone="danger">
              약속 시간이 {b.alertHours}시간 안으로 다가왔는데 기사가 정해지지 않은 예약이 있습니다. 먼저
              배정해 주세요.
            </Alert>
          ) : null}

          <div className="adm-board">
            <section className="adm-board-queue" aria-label="배정 대기">
              <h2 className="ac-h3">
                배정 대기 <span className="ac-num">{waiting.length}</span>
              </h2>
              {waiting.length === 0 ? <Empty /> : null}
              <ul className="adm-board-cards">
                {waiting.map((c) => (
                  <li key={c.id}>
                    <article
                      className={`ac-card adm-board-card${c.urgent ? ' is-urgent' : ''}`}
                      draggable={p.canUpdate}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', String(c.id));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      aria-label={`${c.orderNo} 배정 대기`}
                    >
                      <div className="adm-board-card__head">
                        <StatusBadge code={c.status} audience="staff" />
                        {c.urgent ? <Tag tone="danger">임박</Tag> : null}
                        {c.selfRequested ? <Tag tone="warning">자가 배정 승인 대기</Tag> : null}
                        {c.requiredTechCount > 1 ? <Tag tone="warning">{c.requiredTechCount}인</Tag> : null}
                      </div>
                      <p className="adm-board-card__time ac-num">
                        {hm(c.start)}~{c.end ? hm(c.end) : ''}
                      </p>
                      <p>
                        <span className="ac-num">{c.orderNo}</span> · {c.customerName}
                      </p>
                      <p className="ac-caption">{c.address}</p>
                      <p className="ac-caption">
                        {c.devices
                          .map((d) => `${L('DEVICE_TYPE', d.deviceType)} ${d.quantity}대`)
                          .join(', ') || '품목 없음'}
                      </p>
                      {p.canUpdate ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAssigning({ card: c, mainTechId: null })}
                        >
                          배정
                        </Button>
                      ) : null}
                    </article>
                  </li>
                ))}
              </ul>
            </section>

            <section className="adm-board-gantt" aria-label="기사별 일정">
              <div className="ac-table-wrap">
                <table className="ac-table adm-gantt">
                  <thead>
                    <tr>
                      <th scope="col">기사</th>
                      {p.hours.map((h) => (
                        <th key={h} scope="col" className="ac-num">
                          {String(h).padStart(2, '0')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.techs.length === 0 ? (
                      <tr>
                        <td colSpan={p.hours.length + 1}>
                          <Empty>이 거점에 활동 중인 기사가 없습니다.</Empty>
                        </td>
                      </tr>
                    ) : null}
                    {b.techs.map((t) => {
                      const mine = placed.filter((c) => c.assignments.some((a) => a.technicianId === t.id));
                      return (
                        <tr
                          key={t.id}
                          className={dropOn === t.id ? 'is-drop' : undefined}
                          onDragOver={(e) => {
                            if (!p.canUpdate) return;
                            e.preventDefault();
                            setDropOn(t.id);
                          }}
                          onDragLeave={() => setDropOn((v) => (v === t.id ? null : v))}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDropOn(null);
                            const card = cardById(Number(e.dataTransfer.getData('text/plain')));
                            if (card && WAITING.includes(card.status))
                              setAssigning({ card, mainTechId: t.id });
                          }}
                        >
                          <th scope="row" className="adm-gantt-tech">
                            <span>{t.name}</span>
                            <span className="adm-gantt-tags">
                              <Tag>{L('TECH_GRADE', t.grade)}</Tag>
                              {t.needsAccompany ? (
                                <Tag tone="warning">
                                  동행{' '}
                                  <span className="ac-num">
                                    {t.accompanyDone}/{t.accompanyRequired}
                                  </span>
                                </Tag>
                              ) : null}
                              {t.workHours.length === 0 ? <Tag>휴무</Tag> : null}
                            </span>
                          </th>
                          {p.hours.map((h) => {
                            const here = mine.filter((c) => c.start && kstHour(c.start) === h);
                            const off = !t.workHours.includes(h);
                            return (
                              <td
                                key={h}
                                className={`adm-gantt-cell${off ? ' is-off' : ''}`}
                                aria-label={off ? `${h}시 근무 외` : undefined}
                              >
                                {here.map((c) => {
                                  const role =
                                    c.assignments.find((a) => a.technicianId === t.id)?.role ?? 'MAIN';
                                  return (
                                    <button
                                      key={c.id}
                                      type="button"
                                      className={`adm-gantt-job${role !== 'MAIN' ? ' is-sub' : ''}`}
                                      onClick={() =>
                                        p.canUpdate && c.status === 'ASSIGNED' && setUnassigning(c)
                                      }
                                      title={`${c.orderNo} ${hm(c.start)}~${hm(c.end)} ${c.address}`}
                                    >
                                      <span className="ac-num">{hm(c.start)}</span> {c.customerName}
                                      {role !== 'MAIN' ? ` (${L('ASSIGN_ROLE', role)})` : ''}
                                    </button>
                                  );
                                })}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="ac-caption adm-gap-top">
                카드를 기사 줄에 끌어 놓으면 배정 창이 열립니다. 회색 칸은 근무 시간이 아닙니다. 배정된 작업을
                누르면 배정을 취소할 수 있습니다.
              </p>
            </section>
          </div>

          {assigning ? (
            <AssignModal
              card={assigning.card}
              initialMain={assigning.mainTechId}
              techs={b.techs}
              L={L}
              onClose={() => setAssigning(null)}
              onSaved={() => {
                setAssigning(null);
                toast(MSG.saved);
                router.refresh();
              }}
            />
          ) : null}
          {unassigning ? (
            <UnassignModal
              card={unassigning}
              onClose={() => setUnassigning(null)}
              onSaved={() => {
                setUnassigning(null);
                toast(MSG.saved);
                router.refresh();
              }}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function techLabel(t: TechT, L: (g: string, v: string | null | undefined) => string) {
  return `${t.name} · ${L('TECH_GRADE', t.grade)}${t.needsAccompany ? ' · 동행 필요' : ''}`;
}

function AssignModal(p: {
  card: CardT;
  initialMain: number | null;
  techs: TechT[];
  L: (g: string, v: string | null | undefined) => string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [main, setMain] = useState(p.initialMain ? String(p.initialMain) : '');
  const [support, setSupport] = useState('');
  const [accompany, setAccompany] = useState('');
  const [issues, setIssues] = useState<AssignIssue[] | null>(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const values = useMemo(
    () => ({
      orderId: p.card.id,
      mainTechId: main,
      supportTechId: support,
      accompanyTechId: accompany,
      confirmWarnings: ack ? 'true' : 'false',
    }),
    [p.card.id, main, support, accompany, ack],
  );

  useEffect(() => {
    setAck(false);
    if (!main) {
      setIssues(null);
      return;
    }
    let live = true;
    checkAssign({
      orderId: p.card.id,
      mainTechId: main,
      supportTechId: support,
      accompanyTechId: accompany,
    }).then((r) => {
      if (!live) return;
      if (r.ok) {
        setIssues(r.data as AssignIssue[]);
        setError(null);
      } else setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '점검하지 못했습니다.');
    });
    return () => {
      live = false;
    };
  }, [p.card.id, main, support, accompany]);

  const blocks = issues?.filter((i) => i.level === 'BLOCK') ?? [];
  const warns = issues?.filter((i) => i.level === 'WARN') ?? [];
  const ready = Boolean(main) && issues !== null && blocks.length === 0 && (warns.length === 0 || ack);
  const opts = (exclude: string[]) => p.techs.filter((t) => !exclude.includes(String(t.id)));
  // 동행은 교육 대상 기사(BR-071), 주·보조는 그 밖의 기사
  const trainees = p.techs.filter((t) => t.needsAccompany || t.status === 'TRAINING');

  const save = async () => {
    setConfirming(false);
    setBusy(true);
    const r = await assign({ ...values, confirmWarnings: 'true' });
    setBusy(false);
    if (!r.ok) {
      setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '배정하지 못했습니다.');
      return;
    }
    const out = r.data as { saved: boolean; warnings?: AssignIssue[] };
    if (!out.saved) {
      setIssues(out.warnings ?? []);
      setAck(false);
      return;
    }
    p.onSaved();
  };

  return (
    <>
      <Modal
        open
        form
        title="기사 배정"
        description={`${p.card.orderNo} · ${hm(p.card.start)}~${hm(p.card.end)} · ${p.card.address}`}
        onClose={p.onClose}
        actions={
          <>
            <Button variant="outline" onClick={p.onClose}>
              취소
            </Button>
            <Button variant="primary" disabled={!ready} loading={busy} onClick={() => setConfirming(true)}>
              배정
            </Button>
          </>
        }
      >
        <div className="adm-csl-modal-body">
          <p className="ac-caption">
            {p.card.devices.map((d) => `${p.L('DEVICE_TYPE', d.deviceType)} ${d.quantity}대`).join(', ')}
          </p>
          {p.card.requiredTechCount > 1 ? (
            <Alert tone="warning">
              {p.card.requiredTechCount}인 작업입니다. 보조 기사를 함께 정해야 배정할 수 있습니다.
            </Alert>
          ) : null}
          <Field label="주기사" required>
            {(id, desc, inv) => (
              <Select
                id={id}
                aria-describedby={desc}
                aria-invalid={inv}
                value={main}
                onChange={(e) => setMain(e.target.value)}
              >
                <option value="">선택</option>
                {opts([support, accompany]).map((t) => (
                  <option key={t.id} value={t.id}>
                    {techLabel(t, p.L)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="보조 기사" required={p.card.requiredTechCount > 1}>
            {(id, desc, inv) => (
              <Select
                id={id}
                aria-describedby={desc}
                aria-invalid={inv}
                value={support}
                onChange={(e) => setSupport(e.target.value)}
              >
                <option value="">없음</option>
                {opts([main, accompany]).map((t) => (
                  <option key={t.id} value={t.id}>
                    {techLabel(t, p.L)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="동행 교육 기사"
            help="교육 중인 기사를 함께 보낼 때 고릅니다. 주기사는 교육 가능(LEADER) 등급이어야 합니다."
          >
            {(id, desc, inv) => (
              <Select
                id={id}
                aria-describedby={desc}
                aria-invalid={inv}
                value={accompany}
                onChange={(e) => setAccompany(e.target.value)}
              >
                <option value="">없음</option>
                {trainees
                  .filter((t) => ![main, support].includes(String(t.id)))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {techLabel(t, p.L)}
                    </option>
                  ))}
              </Select>
            )}
          </Field>

          {error ? <Alert tone="danger">{error}</Alert> : null}
          {blocks.length ? (
            <Alert tone="danger">
              <strong>배정할 수 없습니다</strong>
              <ul className="adm-issue-list">
                {blocks.map((i, n) => (
                  <li key={n}>{i.message}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {warns.length ? (
            <Alert tone="warning">
              <strong>확인이 필요합니다</strong>
              <ul className="adm-issue-list">
                {warns.map((i, n) => (
                  <li key={n}>{i.message}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {warns.length && !blocks.length ? (
            <Check
              label="경고 내용을 확인했고 그대로 배정합니다"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
          ) : null}
          {main && issues && issues.length === 0 ? (
            <Alert tone="success">확인할 경고가 없습니다.</Alert>
          ) : null}
        </div>
      </Modal>
      <ConfirmModal
        open={confirming}
        message="배정하시겠습니까?"
        description="기사에게 작업 알림, 고객에게 기사 배정 안내가 나갑니다."
        confirmLabel="배정"
        onCancel={() => setConfirming(false)}
        onConfirm={save}
      />
    </>
  );
}

function UnassignModal(p: { card: CardT; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setConfirming(false);
    setBusy(true);
    const r = await unassign({ orderId: p.card.id, reason });
    setBusy(false);
    if (!r.ok) {
      setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '취소하지 못했습니다.');
      return;
    }
    p.onSaved();
  };
  return (
    <>
      <Modal
        open
        form
        title="배정 취소"
        description={`${p.card.orderNo} · ${hm(p.card.start)} · ${p.card.customerName}`}
        onClose={p.onClose}
        actions={
          <>
            <Button variant="outline" onClick={p.onClose}>
              닫기
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => {
                if (!reason.trim()) {
                  setError(MSG.required('배정 취소 사유'));
                  return;
                }
                setConfirming(true);
              }}
            >
              배정 취소
            </Button>
          </>
        }
      >
        <p className="ac-caption">배정을 취소하면 예약이 배정대기로 돌아가고 기사에게 변경 알림이 갑니다.</p>
        <Field label="배정 취소 사유" required error={error ?? undefined}>
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
      </Modal>
      <ConfirmModal
        open={confirming}
        message="배정을 취소하시겠습니까?"
        confirmLabel="배정 취소"
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={save}
      />
    </>
  );
}
