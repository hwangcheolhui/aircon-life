// A-CUS-010 검색 조건 (주소 쿼리 ↔ 조회 조건)
import type { CustomerListQuery } from '@/server/admin-customers';

const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const str = (v: string | undefined, max: number) => (v && v.trim() ? v.trim().slice(0, max) : null);

export function parseCustomerQuery(sp: Record<string, string | undefined>): CustomerListQuery {
  return {
    name: str(sp.name, 50),
    phone: str(sp.phone, 20),
    address: str(sp.address, 100),
    grade: str(sp.grade, 20),
    tag: str(sp.tag, 30),
    lastFrom: date(sp.from),
    lastTo: date(sp.to),
  };
}
