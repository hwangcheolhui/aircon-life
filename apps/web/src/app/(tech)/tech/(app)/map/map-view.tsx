'use client';
// T-MAP-010 지도 + 핀 미리보기 카드. 핀 번호 = 코스 순서, 색 = 주문 상태(상태 배지와 같은 색), 미배정 핀은 별도 색.
import type { GeoShape, LatLng } from '@aircon/domain';
import { Alert, StatusBadge, Tag } from '@aircon/ui';
import { Navigation, Route } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { formatHm } from '@/customer/format';
import type { RouteView } from '@/server/route-plans';
import type { UnassignedPin } from '@/server/self-assign';
import { GeoMap, MapLegend, type MapPin, pinToneOf } from '@/shared/geo-map';

type Zone = { id: number; zoneName: string; zoneType: string; boundary: GeoShape | null; color: string };
type Selected = { kind: 'job'; key: string } | { kind: 'open'; orderNo: string } | null;

const hm = (iso: string | null) => (iso ? formatHm(new Date(iso)) : '');

/** 길찾기 앱 바로가기 (카카오맵 웹 링크는 앱이 없어도 열림) */
function navLinks(name: string, p: LatLng) {
  const n = encodeURIComponent(name);
  return [
    { label: '카카오맵', href: `https://map.kakao.com/link/to/${n},${p.lat},${p.lng}` },
    { label: '티맵', href: `tmap://route?goalname=${n}&goalx=${p.lng}&goaly=${p.lat}` },
    {
      label: '네이버지도',
      href: `nmap://route/car?dlat=${p.lat}&dlng=${p.lng}&dname=${n}&appname=aircon.tech`,
    },
  ];
}

export function TechMapView(p: {
  date: string;
  zones: Zone[];
  route: RouteView | null;
  unassigned: UnassignedPin[];
  myLoc: (LatLng & { recordedAt: string }) | null;
}) {
  const [sel, setSel] = useState<Selected>(null);
  const stops = p.route?.stops ?? [];
  const jobs = stops.filter((s) => s.type === 'JOB');
  const pins: MapPin[] = [
    ...p.unassigned
      .filter((u) => u.point)
      .map<MapPin>((u) => ({
        id: `u-${u.orderNo}`,
        point: u.point!,
        tone: 'unassigned',
        label: '+',
        title: `미배정 ${u.address} ${hm(u.promisedAt)}`,
        selected: sel?.kind === 'open' && sel.orderNo === u.orderNo,
        onSelect: () => setSel({ kind: 'open', orderNo: u.orderNo }),
      })),
    ...stops
      .filter((s) => s.point)
      .map<MapPin>((s) => ({
        id: s.key,
        point: s.point!,
        tone: s.type === 'JOB' ? pinToneOf(s.orderStatus ?? 'ASSIGNED') : 'break',
        label: String(s.seq),
        title:
          s.type === 'JOB'
            ? `${s.seq}번 ${s.address ?? ''} 도착 예정 ${hm(s.arrival)}`
            : `${s.seq}번 자재 수령`,
        warn: s.violation,
        selected: sel?.kind === 'job' && sel.key === s.key,
        onSelect: s.type === 'JOB' ? () => setSel({ kind: 'job', key: s.key }) : undefined,
      })),
    ...(p.myLoc
      ? [{ id: 'me', point: p.myLoc, tone: 'me' as const, title: `내 위치 (${hm(p.myLoc.recordedAt)})` }]
      : []),
  ];
  const routeLine = p.route
    ? [p.route.start, ...stops.filter((s) => s.point).map((s) => s.point!)]
    : undefined;
  const job = sel?.kind === 'job' ? stops.find((s) => s.key === sel.key) : null;
  const open = sel?.kind === 'open' ? p.unassigned.find((u) => u.orderNo === sel.orderNo) : null;

  return (
    <>
      <GeoMap
        ariaLabel="출동 지도"
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
        route={routeLine}
      />
      <MapLegend
        items={[
          { label: '내 관할', color: `var(--map-zone-${p.zones[0]?.color ?? '1'})` },
          { label: '내 작업(번호=순서)', color: 'var(--status-assigned-fg)' },
          { label: '관할 내 미배정', color: 'var(--map-unassigned)' },
          { label: '내 위치', color: 'var(--map-me)' },
        ]}
      />
      {!p.zones.length ? (
        <Alert tone="warning">지정된 관할 구역이 없습니다. 거점에 관할 구역 지정을 요청하세요.</Alert>
      ) : null}
      {p.route?.missing.length ? (
        <Alert tone="warning">
          주소 좌표를 찾지 못한 작업 {p.route.missing.length}건은 지도와 코스 계산에서 빠졌습니다.
        </Alert>
      ) : null}

      {job ? (
        <section className="ac-card tec-preview" aria-label="선택한 작업">
          <div className="tec-job-card__top">
            <StatusBadge code={job.orderStatus ?? 'ASSIGNED'} audience="staff" />
            <span className="ac-num tec-job-card__time">
              {job.seq}번 · 도착 {hm(job.arrival)}
            </span>
            {job.violation ? <Tag tone="danger">시간창 위반</Tag> : null}
          </div>
          <p>
            {job.customerName} · {job.address}
          </p>
          <p className="ac-caption">
            {job.devices || '기기 정보 없음'} · 허용{' '}
            <span className="ac-num">
              {hm(job.windowStart)}~{hm(job.windowEnd)}
            </span>
          </p>
          <div className="tec-btn-row">
            <Link href={`/tech/jobs/${job.orderNo}`} className="ac-btn ac-btn--outline">
              작업 상세
            </Link>
            {job.point
              ? navLinks(job.address ?? '방문지', job.point).map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    className="ac-btn ac-btn--ghost"
                  >
                    <Navigation aria-hidden /> {l.label}
                  </a>
                ))
              : null}
          </div>
          <p className="ac-caption">고객 전화는 작업 상세에서 연락처 [보기] 후 걸 수 있습니다.</p>
        </section>
      ) : null}

      {open ? (
        <section className="ac-card tec-preview" aria-label="선택한 미배정 작업">
          <div className="tec-job-card__top">
            <Tag tone="warning">미배정</Tag>
            <span className="ac-num tec-job-card__time">
              {hm(open.promisedAt)}
              {open.timeTo ? `~${open.timeTo}` : ''}
            </span>
            {open.requiredTechCount > 1 ? <Tag>{open.requiredTechCount}인</Tag> : null}
            <Tag tone={open.primary ? 'primary' : undefined}>{open.primary ? '주 관할' : '보조 관할'}</Tag>
          </div>
          <p>
            {open.customerName} · {open.address}
          </p>
          <p className="ac-caption">{open.devices}</p>
          <Link
            href={`/tech/route/unassigned?date=${p.date}&focus=${open.orderNo}`}
            className="ac-btn ac-btn--outline ac-btn--block"
          >
            내 일정에 넣을 수 있는지 보기
          </Link>
        </section>
      ) : null}

      <div className="tec-section">
        <div className="tec-head-row">
          <h2 className="ac-h3">
            코스 <span className="ac-num">{jobs.length}</span>곳
          </h2>
          {p.route ? (
            <Tag tone={p.route.status === 'CONFIRMED' ? 'success' : 'warning'}>
              {p.route.status === 'CONFIRMED' ? '확정' : '미확정'}
            </Tag>
          ) : null}
        </div>
        {p.route ? (
          <p className="ac-caption">
            총 이동 <span className="ac-num">{p.route.totals.travelMin}</span>분 ·{' '}
            <span className="ac-num">{(p.route.totals.distanceM / 1000).toFixed(1)}</span>km
            {p.route.violations ? (
              <>
                {' '}
                · 시간창 위반 <span className="ac-num">{p.route.violations}</span>곳
              </>
            ) : null}
          </p>
        ) : (
          <p className="ac-caption">이 날짜에 배정된 작업이 없습니다.</p>
        )}
        <div className="tec-actions">
          {p.route ? (
            <Link href={`/tech/route?date=${p.date}`} className="ac-btn ac-btn--primary ac-btn--lg">
              <Route aria-hidden /> 코스 짜기
            </Link>
          ) : null}
          <Link href={`/tech/route/unassigned?date=${p.date}`} className="ac-btn ac-btn--outline ac-btn--lg">
            관할 내 미배정 작업 <span className="ac-num">{p.unassigned.length}</span>건
          </Link>
        </div>
      </div>
    </>
  );
}
