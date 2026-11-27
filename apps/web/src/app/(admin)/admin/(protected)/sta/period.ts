// A-STA-020·030·040 공통 조회 기간 (기본 이번 달 1일 ~ 오늘, 한국 날짜)
import { kstDate } from '@aircon/domain';

const isDate = (v: string | undefined) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

export function periodOf(sp: Record<string, string | undefined>, now = new Date()) {
  const today = kstDate(now);
  const from = isDate(sp.from) ? sp.from! : `${today.slice(0, 7)}-01`;
  const to = isDate(sp.to) ? sp.to! : today;
  return from <= to ? { from, to } : { from: to, to: from };
}
