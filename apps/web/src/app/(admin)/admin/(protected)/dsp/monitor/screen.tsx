'use client';
// A-DSP-070 코스 모니터링 지도 (F-ADM-DSP-09): 일자 Enter = 조회, 기사 선택 → 지도(정류장 핀·경로선·최근 위치) + 정류장 타임라인, 변경 요청 승인·반려
import type { LatLng } from '@aircon/domain';
import { Alert, Button, Empty, Field, Input, MSG, Modal, Tag, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime, formatHm } from '@/customer/format';
import type { monitorBoard } from '@/server/route-monitor';
import { GeoMap, type MapPin, pinToneOf } from '@/shared/geo-map';
import { decideRouteChangeAction } from './actions';

type Plan = Awaited<ReturnType<typeof monitorBoard>>[number];
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };
const hm = (d: Date | string | null) => (d ? formatHm(new Date(d)) : '-');

export function MonitorScreen(p: { plans: Plan[]; codes: Record<string, Option[]>; date: string; canDecide: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [date, setDate] = useState(p.date);
  const [selId, setSelId] = useState<number | null>(p.plans[0]?.planId ?? null);
  const [decide, setDecide] = useState<Plan | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sel = p.plans.find((x) => x.planId === selId) ?? null;

  const pins: MapPin[] = sel
    ? [
        ...sel.stops
          .filter((s) => s.point)
          .map((s) => ({
            id: `s${s.id}`,
            point: s.point!,
            tone: s.type === 'JOB' ? pinToneOf(s.orderStatus ?? 'ASSIGNED') : ('break' as const),
            label: String(s.seq),
            title: `${s.seq}번 ${s.orderNo ?? '휴식'} 예상 도착 ${hm(s.eta ?? s.plannedArrival)}`,
            warn: s.late || s.violation,
          })),
        ...(sel.location ? [{ id: 'me', point: { lat: sel.location.lat, lng: sel.location.lng }, tone: 'me' as const, title: `${sel.techName} 최근 위치 ${hm(sel.location.at)}` }] : []),
      ]
    : [];
  const line: LatLng[] = sel ? sel.stops.filter((s) => s.point).map((s) => s.point!) : [];

  const close = () => {
    setDecide(null);
    setNote('');
    setError(null);
  };
  const submit = async (approve: boolean) => {
    if (!decide) return;
    setBusy(true);
    const r = (await decideRouteChangeAction({ planId: decide.planId, approve, note })) as Res;
    setBusy(false);
    if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '저장하지 못했습니다.');
    close();
    toast(MSG.saved);
    router.refresh();
  };
  const lateCount = (x: Plan) => x.stops.filter((s) => s.late).length;

  return (
    <>
      <div className="adm-page-head">
        <h1 className="ac-h1">코스 모니터링</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/admin/dsp/monitor?date=${date}`);
        }}
      >
        <Field label="코스 일자">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <div className="ac-search-panel__actions">
          <Button type="submit" variant="primary" size="sm">
            조회
          </Button>
        </div>
      </form>
      {p.plans.length === 0 ? (
        <Empty />
      ) : (
        <div className="adm-monitor adm-gap-top">
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">기사</th>
                  <th scope="col">코스</th>
                  <th scope="col" className="is-num">
                    정류장
                  </th>
                  <th scope="col" className="is-num">
                    지연
                  </th>
                  <th scope="col">변경 요청</th>
                </tr>
              </thead>
              <tbody>
                {p.plans.map((x) => (
                  <tr key={x.planId} aria-selected={x.planId === selId} className={x.planId === selId ? 'is-selected' : undefined} onClick={() => setSelId(x.planId)} onDoubleClick={() => setSelId(x.planId)}>
                    <td>
                      {x.techName}
                      <span className="ac-caption"> {x.branchName ?? ''}</span>
                    </td>
                    <td>{labelOf(p.codes.ROUTE_STATUS, x.status)}</td>
                    <td className="is-num ac-num">{x.stops.filter((s) => s.type === 'JOB').length}</td>
                    <td className="is-num ac-num">{lateCount(x) ? <Tag tone="danger">{`${lateCount(x)}곳`}</Tag> : '-'}</td>
                    <td>
                      {x.change ? <Tag tone={x.change.status === 'REQUESTED' ? 'warning' : x.change.status === 'APPROVED' ? 'success' : undefined}>{labelOf(p.codes.ROUTE_CHANGE_STATUS, x.change.status)}</Tag> : '-'}
                      {x.change?.status === 'REQUESTED' && p.canDecide ? (
                        <Button size="sm" variant="outline" onClick={() => setDecide(x)}>
                          처리
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sel ? (
            <div className="ac-stack">
              <GeoMap ariaLabel={`${sel.techName} 코스 지도`} pins={pins} route={line} aspect="16 / 9" />
              <p className="ac-caption">
                {sel.location ? `최근 위치 ${hm(sel.location.at)} 기준. ` : '오늘 받은 위치가 없습니다. '}
                빨간 테두리 핀은 예정보다 늦거나 시간창을 벗어난 곳입니다.
              </p>
              <table className="ac-table">
                <thead>
                  <tr>
                    <th scope="col" className="is-num">
                      순서
                    </th>
                    <th scope="col">접수번호</th>
                    <th scope="col">고객·주소</th>
                    <th scope="col">상태</th>
                    <th scope="col">예정</th>
                    <th scope="col">안내</th>
                    <th scope="col">예상 도착</th>
                    <th scope="col">실제 도착</th>
                  </tr>
                </thead>
                <tbody>
                  {sel.stops.map((s) => (
                    <tr key={s.id}>
                      <td className="is-num ac-num">{s.seq}</td>
                      <td className="ac-num">{s.orderNo ?? '휴식'}</td>
                      <td>{[s.customerName, s.address].filter(Boolean).join(' · ') || '-'}</td>
                      <td>{labelOf(p.codes.STOP_STATUS, s.status)}</td>
                      <td className="ac-num">{hm(s.plannedArrival)}</td>
                      <td className="ac-num">{hm(s.notifiedArrival)}</td>
                      <td className="ac-num">
                        {hm(s.eta)}
                        {s.delayMin !== null && s.delayMin > 0 ? <Tag tone={s.late ? 'danger' : undefined}>{`+${s.delayMin}분`}</Tag> : null}
                      </td>
                      <td className="ac-num">{hm(s.actualArrival)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
      <Modal
        open={decide !== null}
        title="코스 변경 요청"
        description={decide ? `${decide.techName} · 요청 ${formatDateTime(decide.change?.requestedAt ? new Date(decide.change.requestedAt) : null)}` : undefined}
        onClose={close}
        form
        actions={
          <>
            <Button variant="outline" onClick={close}>
              닫기
            </Button>
            <Button variant="danger" loading={busy} onClick={() => submit(false)}>
              반려
            </Button>
            <Button variant="primary" loading={busy} onClick={() => submit(true)}>
              승인
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <p className="ac-body adm-pre">요청 사유: {decide?.change?.note ?? '-'}</p>
        <p className="ac-caption">승인하면 기사가 확정된 코스를 다시 고친 뒤 확정할 수 있습니다.</p>
        <Field label="처리 메모" help="반려할 때는 사유를 꼭 적어 주세요.">
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </Modal>
    </>
  );
}
