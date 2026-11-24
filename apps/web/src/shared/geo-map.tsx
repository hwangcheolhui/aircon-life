'use client';
/**
 * 지도 (단계 4-2: T-MAP-010 · T-RTE-010 · T-RTE-020 · A-DSP-060). 디자인 시스템 .ac-map 을 쓴다(05 §5.13).
 * 지도 SDK(카카오맵) 실연동 전의 모의 지도: 배경 타일 없이 위경도를 화면 비율에 맞춰 도식으로 그린다.
 * - 관할 구역(GeoJSON)·코스 경로선·작성 중 다각형은 SVG, 핀·법정동 점은 터치 가능한 HTML 버튼(aria-label 필수).
 * - onMapClick 을 주면 클릭한 지점의 위경도를 돌려준다(관할 구역 직접 그리기).
 * 실연동 때는 같은 props 로 지도 SDK 렌더러를 붙인다.
 */
import { type GeoShape, type LatLng, type Position, boundsOf, shapePoints } from '@aircon/domain';
import { type CSSProperties, type MouseEvent, useMemo } from 'react';

export type PinTone =
  | 'received'
  | 'assign-wait'
  | 'assigned'
  | 'on-the-way'
  | 'in-progress'
  | 'pending'
  | 'work-done'
  | 'completed'
  | 'canceled'
  | 'unassigned'
  | 'muted'
  | 'me'
  | 'break';

/** 주문 상태 코드 → 핀 색 (상태 배지와 같은 색) */
export const pinToneOf = (status: string): PinTone => status.toLowerCase().replace(/_/g, '-') as PinTone;

export interface MapPin {
  id: string;
  point: LatLng;
  tone: PinTone;
  /** 핀 안 글자 (코스 순서 등) */
  label?: string;
  /** 스크린리더·툴팁 */
  title: string;
  selected?: boolean;
  /** 관할 밖 등 경고 표시 */
  warn?: boolean;
  onSelect?: () => void;
}

export interface MapShape {
  id: string;
  shape: GeoShape;
  /** 팔레트 1~6 */
  palette: string;
  secondary?: boolean;
  title?: string;
}

export interface MapDong {
  code: string;
  label: string;
  center: LatLng;
  pressed?: boolean;
  state?: 'gap' | 'overlap' | null;
  onToggle?: () => void;
}

const VIEW_W = 1000;

function parseAspect(a: string) {
  const [w, h] = a.split('/').map((x) => Number(x.trim()));
  return w && h ? w / h : 4 / 3;
}

export function GeoMap({
  shapes = [],
  pins = [],
  route,
  draft,
  dongs = [],
  fitPoints,
  onMapClick,
  ariaLabel,
  aspect = '4 / 3',
}: {
  shapes?: MapShape[];
  pins?: MapPin[];
  route?: LatLng[];
  /** 그리는 중인 다각형 꼭짓점 [경도, 위도] */
  draft?: Position[];
  dongs?: MapDong[];
  /** 지도 범위를 이 점들에 맞춘다(없으면 그린 것 전체) */
  fitPoints?: LatLng[];
  onMapClick?: (p: LatLng) => void;
  ariaLabel: string;
  aspect?: string;
}) {
  const ratio = parseAspect(aspect);
  const view = useMemo(() => {
    const all: LatLng[] = fitPoints?.length
      ? fitPoints
      : [
          ...shapes.flatMap((s) => shapePoints(s.shape)),
          ...pins.map((p) => p.point),
          ...(route ?? []),
          ...dongs.map((d) => d.center),
          ...(draft ?? []).map(([lng, lat]) => ({ lat, lng })),
        ];
    const b = boundsOf(all) ?? { minLat: 37.54, maxLat: 37.59, minLng: 126.95, maxLng: 127.0 };
    const lat0 = (b.minLat + b.maxLat) / 2;
    const k = Math.cos((lat0 * Math.PI) / 180);
    let w = Math.max((b.maxLng - b.minLng) * k, 0.004);
    let h = Math.max(b.maxLat - b.minLat, 0.004);
    w *= 1.25;
    h *= 1.25;
    if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
    const cx = ((b.minLng + b.maxLng) / 2) * k;
    const cy = (b.minLat + b.maxLat) / 2;
    return { k, x0: cx - w / 2, yTop: cy + h / 2, w, h };
  }, [shapes, pins, route, dongs, draft, fitPoints, ratio]);

  const fx = (p: LatLng) => ((p.lng * view.k - view.x0) / view.w) * 100;
  const fy = (p: LatLng) => ((view.yTop - p.lat) / view.h) * 100;
  const viewH = VIEW_W / ratio;
  const sx = (p: LatLng) => (fx(p) / 100) * VIEW_W;
  const sy = (p: LatLng) => (fy(p) / 100) * viewH;
  const ringPath = (ring: Position[]) => ring.map(([lng, lat], i) => `${i ? 'L' : 'M'}${sx({ lat, lng }).toFixed(1)},${sy({ lat, lng }).toFixed(1)}`).join('') + 'Z';
  const shapePath = (s: GeoShape) => (s.type === 'Polygon' ? [s.coordinates] : s.coordinates).map((poly) => poly.map(ringPath).join('')).join('');

  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (!onMapClick) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    onMapClick({ lat: view.yTop - py * view.h, lng: (view.x0 + px * view.w) / view.k });
  };

  return (
    <div
      className={`ac-map${onMapClick ? ' ac-map--drawing' : ''}`}
      style={{ '--map-aspect': aspect } as CSSProperties}
      role="group"
      aria-label={ariaLabel}
      onClick={click}
    >
      <svg className="ac-map__svg" viewBox={`0 0 ${VIEW_W} ${viewH.toFixed(1)}`} preserveAspectRatio="none" aria-hidden focusable="false">
        {[1, 2, 3].map((i) => (
          <g key={i}>
            <line className="ac-map__grid" x1={(VIEW_W * i) / 4} y1={0} x2={(VIEW_W * i) / 4} y2={viewH} />
            <line className="ac-map__grid" x1={0} y1={(viewH * i) / 4} x2={VIEW_W} y2={(viewH * i) / 4} />
          </g>
        ))}
        {shapes.map((s) => (
          <path key={s.id} className={`ac-map__zone ac-map__zone--${s.palette}${s.secondary ? ' is-secondary' : ''}`} d={shapePath(s.shape)} fillRule="evenodd">
            {s.title ? <title>{s.title}</title> : null}
          </path>
        ))}
        {route && route.length > 1 ? <polyline className="ac-map__route" points={route.map((p) => `${sx(p).toFixed(1)},${sy(p).toFixed(1)}`).join(' ')} /> : null}
        {draft && draft.length ? (
          draft.length > 2 ? (
            <path className="ac-map__draft" d={ringPath(draft)} />
          ) : (
            <polyline className="ac-map__draft" points={draft.map(([lng, lat]) => `${sx({ lat, lng }).toFixed(1)},${sy({ lat, lng }).toFixed(1)}`).join(' ')} />
          )
        ) : null}
      </svg>
      {dongs.map((d) => (
        <button
          key={d.code}
          type="button"
          className={`ac-map__dong${d.state === 'gap' ? ' is-gap' : d.state === 'overlap' ? ' is-overlap' : ''}`}
          style={{ left: `${fx(d.center)}%`, top: `${fy(d.center)}%` }}
          aria-pressed={d.onToggle ? Boolean(d.pressed) : undefined}
          aria-label={`${d.label}${d.state === 'gap' ? ' (주 관할 없음)' : d.state === 'overlap' ? ' (주 관할 겹침)' : ''}`}
          disabled={!d.onToggle}
          onClick={d.onToggle}
        >
          {d.label.split(' ').pop()}
        </button>
      ))}
      {draft?.map(([lng, lat], i) => (
        <span key={`v${i}`} className="ac-map__pin ac-map__pin--break" style={{ left: `${fx({ lat, lng })}%`, top: `${fy({ lat, lng })}%`, pointerEvents: 'none' }} aria-hidden>
          <span className="ac-map__dot">{i + 1}</span>
        </span>
      ))}
      {pins.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`ac-map__pin ac-map__pin--${p.tone}${p.selected ? ' is-selected' : ''}`}
          style={{ left: `${fx(p.point)}%`, top: `${fy(p.point)}%` }}
          aria-label={p.title}
          aria-pressed={p.onSelect ? Boolean(p.selected) : undefined}
          title={p.title}
          onClick={p.onSelect}
          tabIndex={p.onSelect ? 0 : -1}
        >
          <span className="ac-map__dot">
            {p.label ?? ''}
            {p.warn ? (
              <span className="ac-map__warn" aria-hidden>
                !
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** 범례 */
export function MapLegend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="ac-map-legend" aria-label="지도 범례">
      {items.map((i) => (
        <li key={i.label}>
          <span className="ac-map-legend__swatch" style={{ '--swatch': i.color } as CSSProperties} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
