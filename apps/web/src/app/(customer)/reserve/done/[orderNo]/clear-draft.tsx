'use client';
// 예약이 끝나면 브라우저에 임시 보관한 견적·예약 입력값을 지운다
import { useEffect } from 'react';

export function ClearReserveDraft() {
  useEffect(() => {
    try {
      sessionStorage.removeItem('ac.reserve.v1');
      sessionStorage.removeItem('ac.quote.v1');
    } catch {
      // 무시
    }
  }, []);
  return null;
}
