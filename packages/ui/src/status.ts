import tokens from './styles/tokens.json';

type StatusEntry = { labelCustomer: string; labelStaff: string; className: string; overdue48h?: { className: string } };
const statusMap = (tokens as unknown as { status: Record<string, StatusEntry> }).status;

/** 주문 상태 배지 정보 (tokens.json status 맵이 단일 출처, 05 §8.3) */
export function statusBadgeInfo(code: string, audience: 'customer' | 'staff', opts: { overdue48h?: boolean } = {}) {
  const s = statusMap[code];
  if (!s) return { label: code, className: '' };
  const className = opts.overdue48h && s.overdue48h ? s.overdue48h.className : s.className;
  return { label: audience === 'customer' ? s.labelCustomer : s.labelStaff, className };
}
