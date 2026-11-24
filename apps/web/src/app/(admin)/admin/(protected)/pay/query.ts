// 결제 관리 화면 공통 조회 조건 (A-PAY-010·020·030): 기간 기본값 = 최근 N일(KST)
import { kstDate } from '@aircon/domain';

const isDate = (v: string | undefined) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

export function periodOf(sp: Record<string, string | undefined>, days: number, now = new Date()) {
  const to = isDate(sp.to) ? sp.to! : kstDate(now);
  const from = isDate(sp.from) ? sp.from! : kstDate(new Date(now.getTime() - (days - 1) * 86_400_000));
  return { from, to };
}
