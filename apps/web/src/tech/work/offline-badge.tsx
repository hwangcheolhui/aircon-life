'use client';
// 오프라인 상태 표시 (05 .ac-offline, 03 §6.2 기사 앱 "오프라인 저장 표시")
import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

export function OfflineBadge() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  if (!offline) return null;
  return (
    <span className="ac-offline">
      <WifiOff aria-hidden /> 오프라인
    </span>
  );
}
