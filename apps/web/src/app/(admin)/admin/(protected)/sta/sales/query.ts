// A-STA-010 매출 통계 조회 조건: 기간(기본 이번 달 1일~오늘)·단위·기준
import type { SalesDimension } from '@/server/ops';
import { kstDate, type StatUnit } from '@aircon/domain';

const isDate = (v: string | undefined) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
const UNITS: StatUnit[] = ['DAY', 'WEEK', 'MONTH'];
const DIMS: SalesDimension[] = ['BRANCH', 'PRODUCT', 'CHANNEL', 'CUSTOMER_TYPE'];

export function salesQueryOf(sp: Record<string, string | undefined>, now = new Date()) {
  const today = kstDate(now);
  return {
    from: isDate(sp.from) ? sp.from! : `${today.slice(0, 7)}-01`,
    to: isDate(sp.to) ? sp.to! : today,
    unit: (UNITS as string[]).includes(sp.unit ?? '') ? (sp.unit as StatUnit) : ('DAY' as StatUnit),
    dimension: (DIMS as string[]).includes(sp.dimension ?? '') ? (sp.dimension as SalesDimension) : ('BRANCH' as SalesDimension),
  };
}
