// A-CSL-070 검색 조건 (주소 쿼리 ↔ 조회 조건)
import type { ConsultListQuery } from '@/server/consult';

const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const str = (v: string | undefined, max: number) => (v && v.trim() ? v.trim().slice(0, max) : null);

export function parseConsultQuery(sp: Record<string, string | undefined>): ConsultListQuery {
  const agent = Number(sp.agent);
  return {
    dateFrom: date(sp.from),
    dateTo: date(sp.to),
    consultType: str(sp.type, 20),
    status: str(sp.status, 20),
    agentId: Number.isInteger(agent) && agent > 0 ? agent : null,
    keyword: str(sp.q, 40),
  };
}
