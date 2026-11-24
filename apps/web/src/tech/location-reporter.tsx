'use client';
// F-TEC-MAP-05 근무 중 위치 전송 (BR-115): 근무 중일 때만 LOCATION_INTERVAL_SEC 간격으로 보낸다. 근무 종료하면 이 컴포넌트가 사라져 멈춘다.
// 브라우저가 위치 권한을 거절하면 조용히 멈춘다(근무 토글 카드에 안내).
import { useEffect } from 'react';
import { sendLocation } from '@/app/(tech)/tech/(app)/actions';

export function LocationReporter({ intervalSec }: { intervalSec: number }) {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let stopped = false;
    const tick = () =>
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (stopped) return;
          void sendLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
            speedKmh:
              pos.coords.speed === null || !Number.isFinite(pos.coords.speed) ? null : pos.coords.speed * 3.6,
          });
        },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
      );
    tick();
    const id = window.setInterval(tick, Math.max(30, intervalSec) * 1000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [intervalSec]);
  return null;
}
