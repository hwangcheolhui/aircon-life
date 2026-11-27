/**
 * 메모 업무 규칙 (단계 10, F-TEC-MEMO-01 · F-TEC-CAL-02 · F-TEC-HOM-02·03 · F-ADM-CNT-04, 01 §2.13.2).
 * - 기간: 반복 없음(NONE)이면 start_date~end_date 의 모든 날, 반복이 있으면 start_date 부터 end_date(반복 종료일)까지 규칙에 맞는 날.
 *   DAILY 매일 · WEEKLY 같은 요일 · MONTHLY 같은 날(그 달에 없으면 말일) · YEARLY 같은 월·일(2/29 는 평년 2/28).
 * - 표시 순서(오늘의 메모): 거점장 > 관리자 > 본인 (02 F-TEC-HOM-02), 같은 순위는 완료 안 한 것 먼저, 등록 순.
 */
import { MSG } from '../messages';

export const MEMO_HEADERS = ['RECEIVABLE', 'REVISIT', 'CUSTOMER_CONTACT', 'MANUAL'] as const;
export type MemoHeader = (typeof MEMO_HEADERS)[number];
export const MEMO_REPEATS = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type MemoRepeat = (typeof MEMO_REPEATS)[number];
/** memo.priority_source: 누가 쓴 메모인지 = 표시 우선순위 근거 */
export const MEMO_PRIORITY_SOURCES = ['BRANCH_MANAGER', 'ADMIN', 'SELF'] as const;
export type MemoPrioritySource = (typeof MEMO_PRIORITY_SOURCES)[number];

/** 메모 내용 최대 글자 (memo.content VARCHAR(1000)) */
export const MEMO_CONTENT_MAX = 1000;
/** 반복 없는 메모의 최대 기간(일) — 한 메모가 달력을 뒤덮지 않게 */
export const MEMO_RANGE_MAX_DAYS = 31;

export interface MemoLike {
  startDate: string;
  endDate: string;
  repeatType: string;
}

const toUtc = (d: string) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
};
const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** YYYY-MM-DD + n일 */
export function addDaysStr(date: string, n: number): string {
  return new Date(toUtc(date) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 메모가 그 날짜에 보이는지 */
export function memoOccursOn(m: MemoLike, date: string): boolean {
  if (date < m.startDate || date > m.endDate) return false;
  const [, sm, sd] = m.startDate.split('-').map(Number) as [number, number, number];
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  switch (m.repeatType) {
    case 'DAILY':
    case 'NONE':
    case '':
      return true;
    case 'WEEKLY':
      return daysBetween(m.startDate, date) % 7 === 0;
    case 'MONTHLY':
      return d === Math.min(sd, lastDayOf(y, mo));
    case 'YEARLY':
      return mo === sm && d === Math.min(sd, lastDayOf(y, mo));
    default:
      return false;
  }
}

/** from~to(포함) 중 메모가 보이는 날짜들 */
export function memoDatesInRange(m: MemoLike, from: string, to: string): string[] {
  const out: string[] = [];
  const start = from > m.startDate ? from : m.startDate;
  const end = to < m.endDate ? to : m.endDate;
  for (let d = start; d <= end; d = addDaysStr(d, 1)) if (memoOccursOn(m, d)) out.push(d);
  return out;
}

/** 메모 입력 검증 (T-MEMO-010, A-CNT-040). 오류 문구를 돌려주고 문제가 없으면 null */
export function checkMemoInput(i: { content: string; startDate: string; endDate: string; repeatType: string; today: string }): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!i.content.trim()) errors.content = MSG.required('내용');
  else if (i.content.length > MEMO_CONTENT_MAX) errors.content = `내용은 ${MEMO_CONTENT_MAX}자 이내로 입력해 주세요.`;
  if (!(MEMO_REPEATS as readonly string[]).includes(i.repeatType)) errors.repeatType = '반복 설정을 다시 골라 주세요.';
  if (i.endDate < i.startDate) errors.endDate = i.repeatType === 'NONE' ? '종료일은 시작일 이후여야 합니다.' : '반복 종료일은 시작일 이후여야 합니다.';
  else if (i.repeatType === 'NONE' && daysBetween(i.startDate, i.endDate) + 1 > MEMO_RANGE_MAX_DAYS)
    errors.endDate = `기간은 ${MEMO_RANGE_MAX_DAYS}일 이내로 정해 주세요. 더 길면 반복을 써 주세요.`;
  else if (i.endDate < i.today) errors.endDate = '이미 지난 기간입니다. 종료일을 오늘 이후로 정해 주세요.';
  return Object.keys(errors).length ? errors : null;
}

const PRIORITY_RANK: Record<string, number> = { BRANCH_MANAGER: 0, ADMIN: 1, SELF: 2 };

/** 오늘의 메모 정렬: 거점장 > 관리자 > 본인, 미완료 먼저, 등록 순 (F-TEC-HOM-02) */
export function sortTodayMemos<T extends { prioritySource: string | null; isDone: boolean; id: number }>(memos: readonly T[]): T[] {
  return [...memos].sort(
    (a, b) =>
      (PRIORITY_RANK[a.prioritySource ?? 'SELF'] ?? 2) - (PRIORITY_RANK[b.prioritySource ?? 'SELF'] ?? 2) ||
      Number(a.isDone) - Number(b.isDone) ||
      a.id - b.id,
  );
}

/** 관리자가 보내는 지정 메모의 우선순위 근거: 거점장 역할이면 BRANCH_MANAGER, 그 밖의 관리자는 ADMIN */
export const adminMemoSource = (roleCode: string): MemoPrioritySource => (roleCode === 'ADM_BRANCH' ? 'BRANCH_MANAGER' : 'ADMIN');

/** 기사가 고치거나 지울 수 있는 메모 = 본인이 쓴 메모만 (받은 지정 메모는 완료 체크·확인만) */
export const canEditMemo = (m: { ownerType: string; ownerId: number }, techId: number) => m.ownerType === 'TECHNICIAN' && m.ownerId === techId;
