import 'server-only';
import { headers } from 'next/headers';

/** 알림 링크용 사이트 주소 (APP_BASE_URL 이 있으면 그 값, 없으면 요청 주소) — 단계 5-1 작업 리포트, 5-2 추가요금 동의 링크 */
export async function siteOrigin() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export const extraAgreeUrl = (origin: string) => (orderNo: string) => `${origin}/orders/${orderNo}/extra`;
