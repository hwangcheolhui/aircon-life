'use client';
// 고객 서명 패드 (05 §6.11 .ac-signature): 처리 저장(T-WRK-060)·추가요금 현장 서명(T-WRK-040, BR-040)
import { Button } from '@aircon/ui';
import { useEffect, useRef } from 'react';

export type SignatureRead = () => Promise<Blob | null>;

/** 서명 패드: 손가락·펜으로 그리면 저장할 때 PNG 로 만든다 */
export function SignaturePad({ readRef }: { readRef: React.MutableRefObject<SignatureRead | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = getComputedStyle(c).color;
    readRef.current = () =>
      dirty.current ? new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png')) : Promise.resolve(null);
  }, [readRef]);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const finish = () => {
    drawing.current = false;
  };
  return (
    <div className="tec-section">
      <canvas
        ref={ref}
        className="ac-signature"
        role="img"
        aria-label="고객 서명 칸"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          dirty.current = true;
          const ctx = e.currentTarget.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 0.1, y + 0.1);
          ctx.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={finish}
        onPointerLeave={finish}
      />
      <Button
        variant="text"
        onClick={() => {
          const c = ref.current!;
          c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
          dirty.current = false;
        }}
      >
        서명 지우기
      </Button>
    </div>
  );
}
