'use client';
// T-RTE-020 목록·지도: 담을 수 있는지(사유), 넣으면 몇 번째·이동 몇 분 늘어나는지 보여 주고 [내 일정에 넣기]. 동시에 누르면 한 명만 성공한다.
import type { GeoShape } from '@aircon/domain';
import { Alert, Button, Empty, Modal, Tag, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatHm } from '@/customer/format';
import type { UnassignedPin } from '@/server/self-assign';
import { GeoMap, type MapPin } from '@/shared/geo-map';
import { requestSelfAssignAction } from '../actions';

type Zone = { id: number; zoneName: string; zoneType: string; boundary: GeoShape | null; color: string };
type Res = { ok: boolean; message?: string; data?: { status: 'REQUESTED' | 'ACCEPTED' } };
const hm = (iso: string | null) => (iso ? formatHm(new Date(iso)) : '');

export function UnassignedList(p: {
  date: string;
  items: UnassignedPin[];
  zones: Zone[];
  deviceOptions: { value: string; label: string }[];
  focus: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [device, setDevice] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(p.focus);
  const [ask, setAsk] = useState<UnassignedPin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const types = [...new Set(p.items.flatMap((i) => i.deviceTypes))];
  const items = p.items.filter((i) => !device || i.deviceTypes.includes(device));
  const label = (v: string) => p.deviceOptions.find((o) => o.value === v)?.label ?? v;

  const pins: MapPin[] = items
    .filter((i) => i.point)
    .map((i) => ({
      id: i.orderNo,
      point: i.point!,
      tone: i.canRequest ? 'unassigned' : 'muted',
      label: '+',
      title: `${i.address} ${hm(i.promisedAt)} ${i.canRequest ? '담기 가능' : '담기 불가'}`,
      selected: sel === i.orderNo,
      onSelect: () => {
        setSel(i.orderNo);
        document.getElementById(`ua-${i.orderNo}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      },
    }));

  const submit = () => {
    if (!ask) return;
    start(async () => {
      const r = (await requestSelfAssignAction({ orderNo: ask.orderNo })) as Res;
      if (!r.ok) {
        setError(r.message ?? '담지 못했습니다.');
        setAsk(null);
        router.refresh();
        return;
      }
      setAsk(null);
      setError(null);
      toast(
        r.data?.status === 'ACCEPTED'
          ? '내 일정에 넣었습니다. 코스 편집에서 순서를 확인하세요.'
          : '거점에 승인을 요청했습니다. 승인되면 알림이 갑니다.',
      );
      router.refresh();
    });
  };

  return (
    <>
      <GeoMap
        ariaLabel="관할 내 미배정 작업 지도"
        shapes={p.zones
          .filter((z) => z.boundary)
          .map((z) => ({
            id: String(z.id),
            shape: z.boundary!,
            palette: z.color,
            secondary: z.zoneType === 'SECONDARY',
            title: z.zoneName,
          }))}
        pins={pins}
      />
      {types.length > 1 ? (
        <div className="ac-chip-row" role="group" aria-label="기기 필터">
          <button
            type="button"
            className="ac-chip"
            aria-pressed={device === null}
            onClick={() => setDevice(null)}
          >
            전체
          </button>
          {types.map((t) => (
            <button
              key={t}
              type="button"
              className="ac-chip"
              aria-pressed={device === t}
              onClick={() => setDevice(t)}
            >
              {label(t)}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {items.length ? (
        <ul className="tec-job-list">
          {items.map((i) => (
            <li
              key={i.orderNo}
              id={`ua-${i.orderNo}`}
              className={`ac-card tec-open-job${sel === i.orderNo ? ' ac-card--selected' : ''}`}
            >
              <div className="tec-job-card__top">
                <Tag tone="warning">미배정</Tag>
                <span className="ac-num tec-job-card__time">
                  {hm(i.promisedAt)}
                  {i.timeTo ? `~${i.timeTo}` : ''}
                </span>
                <Tag tone={i.primary ? 'primary' : undefined}>{i.primary ? '주 관할' : '보조 관할'}</Tag>
                {i.requiredTechCount > 1 ? <Tag>{i.requiredTechCount}인</Tag> : null}
              </div>
              <p>
                {i.customerName} · {i.address}
              </p>
              <p className="ac-caption">{i.devices}</p>
              {i.insertion ? (
                <p className="ac-caption">
                  넣으면 <span className="ac-num">{i.insertion.position}</span>번째 · 도착{' '}
                  <span className="ac-num">{hm(i.insertion.arrival)}</span> · 이동 +
                  <span className="ac-num">{i.insertion.addedTravelMin}</span>분
                </p>
              ) : null}
              {i.canRequest ? (
                <>
                  {i.needsApproval ? <p className="ac-caption">거점 승인 후 확정됩니다.</p> : null}
                  <Button variant="outline" block onClick={() => setAsk(i)} disabled={pending}>
                    내 일정에 넣기
                  </Button>
                </>
              ) : (
                <ul className="tec-reasons" aria-label="담을 수 없는 이유">
                  {i.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty />
      )}
      <Modal
        open={ask !== null}
        title="내 일정에 넣으시겠습니까?"
        description={
          ask
            ? `${hm(ask.promisedAt)} ${ask.address}${ask.insertion ? ` · ${ask.insertion.position}번째, 이동 +${ask.insertion.addedTravelMin}분` : ''}${ask.needsApproval ? ' · 거점 승인 후 확정됩니다.' : ''}`
            : undefined
        }
        onClose={() => setAsk(null)}
        actions={
          <>
            <Button variant="outline" onClick={() => setAsk(null)}>
              취소
            </Button>
            <Button variant="primary" onClick={submit} loading={pending}>
              넣기
            </Button>
          </>
        }
      />
    </>
  );
}
