'use client';
// T-RTE-010 코스 편집기: 상단 지도(경로선) + 하단 순서 리스트(끌어 놓기·▲▼, 🔒 고정), 지점별 도착 예정·이동·허용 시간창, 위반 경고, 총 이동시간·거리
import type { LatLng } from '@aircon/domain';
import { Alert, Button, Modal, StatusBadge, Tag, useToast } from '@aircon/ui';
import { ArrowDown, ArrowUp, Coffee, GripVertical, Lock, LockOpen, Package, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type DragEvent, useState, useTransition } from 'react';
import { formatHm, formatVisitTime } from '@/customer/format';
import type { RouteStopView, RouteView } from '@/server/route-plans';
import { GeoMap, type MapPin, pinToneOf } from '@/shared/geo-map';
import {
  applyRecommendationAction,
  confirmRouteAction,
  previewRouteAction,
  recommendRouteAction,
  saveRouteAction,
} from './actions';

type EditStop = { key: string; type: 'JOB' | 'BREAK' | 'MATERIAL'; locked: boolean; workMin?: number };
type Res<T = unknown> = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: T };
type Rec = {
  before: RouteView;
  after: RouteView;
  savedTravelMin: number;
  savedDistanceM: number;
  unavoidable: boolean;
};

const hm = (iso: string | null) => (iso ? formatHm(new Date(iso)) : '');
const km = (m: number) => (m / 1000).toFixed(1);
const errOf = (r: Res) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '처리하지 못했습니다.';
const toEdit = (v: RouteView): EditStop[] =>
  v.stops.map((s) => ({
    key: s.key,
    type: s.type as EditStop['type'],
    locked: s.locked,
    workMin: s.type === 'JOB' ? undefined : s.workMin,
  }));

function stopTitle(s: RouteStopView) {
  if (s.type === 'BREAK') return '휴식';
  if (s.type === 'MATERIAL') return '자재 수령(거점)';
  return `${s.customerName ?? ''} · ${s.address ?? ''}`;
}

export function RouteEditor({ initial }: { initial: RouteView }) {
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState(initial);
  const [edit, setEdit] = useState<EditStop[]>(() => toEdit(initial));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<Rec | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const readOnly = view.locked || view.status === 'IN_PROGRESS' || view.status === 'DONE';

  /** 순서를 바꾸면 바로 다시 계산 (저장은 따로) */
  const apply = (next: EditStop[]) => {
    setEdit(next);
    setDirty(true);
    setError(null);
    start(async () => {
      const r = (await previewRouteAction({ date: view.date, stops: next })) as Res<RouteView>;
      if (!r.ok) return setError(errOf(r));
      setView(r.data!);
    });
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= edit.length || from === to) return;
    const next = [...edit];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it!);
    apply(next);
  };
  const addStop = (type: 'BREAK' | 'MATERIAL') => {
    apply([...edit, { key: `new${Date.now()}`, type, locked: false, workMin: type === 'BREAK' ? 60 : 20 }]);
  };
  const run = async <T,>(fn: () => Promise<Res<T>>, done: (d: T | undefined) => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(errOf(r));
      done(r.data);
    });
  };
  const save = () =>
    run(
      () => saveRouteAction({ date: view.date, stops: edit }) as Promise<Res<RouteView>>,
      (v) => {
        setView(v!);
        setEdit(toEdit(v!));
        setDirty(false);
        toast('저장에 성공하였습니다.');
        router.refresh();
      },
    );
  const recommend = () =>
    run(
      () => recommendRouteAction({ date: view.date }) as Promise<Res<Rec>>,
      (d) => setRec(d!),
    );
  const applyRec = () =>
    run(
      () => applyRecommendationAction({ date: view.date }) as Promise<Res>,
      () => {
        setRec(null);
        setDirty(false);
        toast('추천 코스를 적용했습니다.');
        router.refresh();
      },
    );
  const confirm = () =>
    run(
      async () => {
        if (dirty) {
          const s = (await saveRouteAction({ date: view.date, stops: edit })) as Res;
          if (!s.ok) return s;
        }
        return confirmRouteAction({ date: view.date }) as Promise<Res<{ notified: number }>>;
      },
      (d) => {
        setConfirmOpen(false);
        setDirty(false);
        const n = (d as { notified?: number } | undefined)?.notified ?? 0;
        toast(n ? `코스를 확정하고 고객 ${n}명에게 방문 예정 시간을 안내했습니다.` : '코스를 확정했습니다.');
        router.refresh();
      },
    );

  const onDrop = (e: DragEvent, to: number) => {
    e.preventDefault();
    const from = edit.findIndex((x) => x.key === dragKey);
    setDragKey(null);
    if (from >= 0) move(from, to);
  };

  const byKey = new Map(view.stops.map((s) => [s.key, s]));
  const pins: MapPin[] = view.stops
    .filter((s) => s.point)
    .map((s) => ({
      id: s.key,
      point: s.point!,
      tone: s.type === 'JOB' ? pinToneOf(s.orderStatus ?? 'ASSIGNED') : 'break',
      label: String(s.seq),
      title: `${s.seq}번 ${stopTitle(s)} 도착 ${hm(s.arrival)}`,
      warn: s.violation,
    }));
  const line: LatLng[] = [view.start, ...view.stops.filter((s) => s.point).map((s) => s.point!)];
  const confirmed = view.status === 'CONFIRMED';

  return (
    <>
      <GeoMap ariaLabel="코스 경로" pins={pins} route={line} aspect="16 / 10" />
      <div className="tec-route-summary" aria-live="polite">
        <div>
          <span className="ac-caption">총 이동</span>
          <strong className="ac-num">{view.totals.travelMin}분</strong>
        </div>
        <div>
          <span className="ac-caption">거리</span>
          <strong className="ac-num">{km(view.totals.distanceM)}km</strong>
        </div>
        <div>
          <span className="ac-caption">방문</span>
          <strong className="ac-num">{view.totals.jobs}곳</strong>
        </div>
        <div>
          <span className="ac-caption">상태</span>
          <Tag tone={confirmed ? 'success' : 'warning'}>
            {confirmed ? `확정 v${view.version}` : dirty ? '편집 중' : '미확정'}
          </Tag>
        </div>
      </div>
      <p className="ac-caption">
        확정 마감 <span className="ac-num">{formatVisitTime(new Date(view.deadline))}</span>. 마감까지
        확정하지 않으면 추천 순서로 자동 확정됩니다.
        {pending ? ' 계산 중…' : ''}
      </p>
      {view.violations ? (
        <Alert tone="danger">
          도착 허용 시간을 벗어난 방문지가 {view.violations}곳 있습니다. 순서를 바꾸거나 [최적 코스 추천]을
          눌러 보세요. 위반이 있으면 확정할 수 없습니다.
        </Alert>
      ) : null}
      {view.overWorkEnd ? (
        <Alert tone="warning">근무 종료 시각({hm(view.workEnd)})을 넘기는 일정이 있습니다.</Alert>
      ) : null}
      {!view.working ? (
        <Alert tone="warning">이 날짜는 근무일이 아닙니다. 거점에 근무 일정을 확인하세요.</Alert>
      ) : null}
      {view.locked ? (
        <Alert tone="warning">확정 마감이 지나 순서를 바꿀 수 없습니다. 바꿔야 하면 거점에 요청하세요.</Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <ol className="tec-route-list" aria-label="방문 순서">
        {edit.map((e, i) => {
          const s = byKey.get(e.key) ?? view.stops[i];
          if (!s) return null;
          return (
            <li
              key={e.key}
              className={`ac-card tec-route-stop${s.violation ? ' is-violation' : ''}${dragKey === e.key ? ' is-dragging' : ''}`}
              draggable={!readOnly && !e.locked}
              onDragStart={() => setDragKey(e.key)}
              onDragOver={(ev) => !readOnly && ev.preventDefault()}
              onDrop={(ev) => onDrop(ev, i)}
            >
              <div className="tec-route-stop__head">
                {!readOnly && !e.locked ? (
                  <GripVertical aria-hidden className="tec-route-stop__grip" />
                ) : null}
                <span className="tec-route-stop__seq ac-num" aria-label={`${i + 1}번째`}>
                  {i + 1}
                </span>
                {s.type === 'JOB' ? (
                  <StatusBadge code={s.orderStatus ?? 'ASSIGNED'} audience="staff" />
                ) : s.type === 'BREAK' ? (
                  <Coffee aria-hidden />
                ) : (
                  <Package aria-hidden />
                )}
                <strong className="ac-num">도착 {hm(s.arrival)}</strong>
                {s.violation ? <Tag tone="danger">시간창 위반</Tag> : null}
                {s.waitMin > 0 ? <Tag>대기 {s.waitMin}분</Tag> : null}
              </div>
              <p>{stopTitle(s)}</p>
              <p className="ac-caption">
                이동 <span className="ac-num">{s.travelMin}</span>분 ·{' '}
                <span className="ac-num">{km(s.distanceM)}</span>km · 작업{' '}
                <span className="ac-num">{s.workMin}</span>분
                {s.windowStart ? (
                  <>
                    {' '}
                    · 허용{' '}
                    <span className="ac-num">
                      {hm(s.windowStart)}~{hm(s.windowEnd)}
                    </span>
                  </>
                ) : null}
                {s.notifiedArrival ? (
                  <>
                    {' '}
                    · 고객 안내 <span className="ac-num">{hm(s.notifiedArrival)}</span>
                  </>
                ) : null}
              </p>
              {!readOnly ? (
                <div className="tec-route-stop__tools">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon
                    aria-label="위로"
                    disabled={i === 0 || e.locked || pending}
                    onClick={() => move(i, i - 1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon
                    aria-label="아래로"
                    disabled={i === edit.length - 1 || e.locked || pending}
                    onClick={() => move(i, i + 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon
                    aria-label={e.locked ? '순서 고정 풀기' : '순서 고정'}
                    aria-pressed={e.locked}
                    onClick={() =>
                      apply(edit.map((x) => (x.key === e.key ? { ...x, locked: !x.locked } : x)))
                    }
                  >
                    {e.locked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
                  </Button>
                  {e.type !== 'JOB' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon
                      aria-label="이 지점 빼기"
                      onClick={() => apply(edit.filter((x) => x.key !== e.key))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {!readOnly ? (
        <div className="tec-btn-row">
          <Button variant="outline" onClick={() => addStop('BREAK')} disabled={pending}>
            <Coffee aria-hidden />
            휴식 추가
          </Button>
          <Button variant="outline" onClick={() => addStop('MATERIAL')} disabled={pending}>
            <Package aria-hidden />
            자재 수령 추가
          </Button>
        </div>
      ) : null}

      {!readOnly ? (
        <div className="tec-actions">
          <Button variant="outline" size="lg" onClick={recommend} loading={pending && !confirmOpen}>
            최적 코스 추천
          </Button>
          {dirty ? (
            <Button variant="outline" size="lg" onClick={save} disabled={pending}>
              저장
            </Button>
          ) : null}
          {!confirmed || dirty ? (
            <Button
              variant="primary"
              size="lg"
              disabled={pending || view.violations > 0}
              onClick={() => setConfirmOpen(true)}
            >
              코스 확정
            </Button>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={rec !== null}
        title="최적 코스 추천"
        description={
          rec
            ? rec.savedTravelMin > 0
              ? `이동시간 ${rec.savedTravelMin}분 · 거리 ${km(rec.savedDistanceM)}km를 줄일 수 있습니다.`
              : rec.after.violations < rec.before.violations
                ? '시간창 위반을 줄이는 순서입니다.'
                : '지금 순서가 이미 가장 짧습니다.'
            : undefined
        }
        onClose={() => setRec(null)}
        actions={
          <>
            <Button variant="outline" onClick={() => setRec(null)}>
              닫기
            </Button>
            <Button variant="primary" onClick={applyRec} loading={pending}>
              추천 적용
            </Button>
          </>
        }
      >
        {rec ? (
          <div className="tec-compare">
            {rec.unavoidable ? (
              <Alert tone="warning">
                어떤 순서로도 시간창을 모두 지킬 수 없습니다. 거점에 일정 조정을 요청하세요.
              </Alert>
            ) : null}
            <table className="ac-table">
              <caption className="ac-sr-only">추천 전후 비교</caption>
              <thead>
                <tr>
                  <th scope="col">구분</th>
                  <th scope="col" className="is-num">
                    지금
                  </th>
                  <th scope="col" className="is-num">
                    추천
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">총 이동</th>
                  <td className="is-num ac-num">{rec.before.totals.travelMin}분</td>
                  <td className="is-num ac-num">{rec.after.totals.travelMin}분</td>
                </tr>
                <tr>
                  <th scope="row">거리</th>
                  <td className="is-num ac-num">{km(rec.before.totals.distanceM)}km</td>
                  <td className="is-num ac-num">{km(rec.after.totals.distanceM)}km</td>
                </tr>
                <tr>
                  <th scope="row">시간창 위반</th>
                  <td className="is-num ac-num">{rec.before.violations}곳</td>
                  <td className="is-num ac-num">{rec.after.violations}곳</td>
                </tr>
              </tbody>
            </table>
            <ol className="tec-compare__order" aria-label="추천 순서">
              {rec.after.stops.map((s) => (
                <li key={s.key}>
                  <span className="ac-num">{hm(s.arrival)}</span> {stopTitle(s)}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={confirmOpen}
        title="코스를 확정하시겠습니까?"
        description="확정하면 고객에게 방문 예정 시간(도착 예정 전후)이 안내됩니다. 마감 전에는 다시 바꿔 재확정할 수 있습니다."
        onClose={() => setConfirmOpen(false)}
        actions={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              취소
            </Button>
            <Button variant="primary" onClick={confirm} loading={pending}>
              확정
            </Button>
          </>
        }
      />
    </>
  );
}
