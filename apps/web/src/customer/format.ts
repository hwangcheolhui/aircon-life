// 고객 화면 금액·시간 표시 (서버·클라이언트 공용)
export const formatWon = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export function formatDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}시간 ${m}분` : h ? `${h}시간` : `${m}분`;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** YYYY-MM-DD → 3월 10일(수) */
export function formatDateLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const w = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return `${m}월 ${d}일(${WEEK[w]})`;
}

/** 시 → 오전 10:00 / 오후 6:00 */
export function formatHourLabel(h: number) {
  const ap = h < 12 ? '오전' : '오후';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${hh}:00`;
}

/** 방문 일시(한국 시간) → 2027년 3월 10일(수) 오전 10:00 */
export function formatVisit(at: Date) {
  const date = at.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const hour = Number(at.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).slice(0, 2));
  return `${date.slice(0, 4)}년 ${formatDateLabel(date)} ${formatHourLabel(hour)}`;
}

/** 일시(한국 시간) → 2027-03-10 10:00 (관리자 표) */
export function formatDateTime(at: Date | null | undefined) {
  if (!at) return '';
  return at.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false }).slice(0, 16);
}

/** 시각(한국 시간) → 오전 10:40 */
export function formatClock(at: Date) {
  const [h, m] = at.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number);
  const ap = h! < 12 ? '오전' : '오후';
  const hh = h! % 12 === 0 ? 12 : h! % 12;
  return `${ap} ${hh}:${String(m).padStart(2, '0')}`;
}

/** 방문 예정 시각 → 3월 10일(수) 오전 10:40 (코스 확정 안내, 단계 4-2) */
export function formatVisitTime(at: Date) {
  return `${formatDateLabel(at.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }))} ${formatClock(at)}`;
}

/** 24시간 표기 10:40 (기사 앱 코스) */
export const formatHm = (at: Date) => at.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
