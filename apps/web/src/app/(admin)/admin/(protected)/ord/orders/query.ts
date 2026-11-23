// A-ORD-010 검색 조건 (주소 쿼리 ↔ 조회 조건)
import type { OrderListQuery } from '@/server/admin-orders';

const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const str = (v: string | undefined, max: number) => (v && v.trim() ? v.trim().slice(0, max) : null);

export function parseOrderQuery(sp: Record<string, string | undefined>): OrderListQuery {
  return {
    dateFrom: date(sp.from),
    dateTo: date(sp.to),
    status: str(sp.status, 20),
    channel: str(sp.channel, 20),
    keyword: str(sp.q, 40),
  };
}
