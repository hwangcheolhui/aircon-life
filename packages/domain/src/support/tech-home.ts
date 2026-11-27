/**
 * 기사 홈·퀵메뉴·월 수입 규칙 (단계 10, F-TEC-HOM-03·04·05 · F-TEC-STL-03).
 * - 퀵메뉴(quick_menu.menu_code = 화면 ID): ★ 로 추가/해제, 순서 변경, 개수 제한 없음(가로 슬라이드)
 * - 주간 할일: D-day·D+1·D+2 날짜별 메모·자재·약속 건수
 * - 월 수입: 회차 종료일이 속한 달로 묶은 실지급 합계(최근 N개월)
 */
import { addMonthsToDate } from '../ops/ops-rules';
import { addDaysStr, memoOccursOn, type MemoLike } from './memo-rules';
import { materialsDueOn } from './material-request';

/** 퀵메뉴에 넣을 수 있는 기사 앱 화면 (03 §3.2 더보기·작업 메뉴). 이름은 03 §3.3 화면명 */
export const TECH_QUICK_MENUS = [
  { code: 'T-JOB-010', name: '작업 목록', href: '/tech/jobs' },
  { code: 'T-MAP-010', name: '출동 지도', href: '/tech/map' },
  { code: 'T-RTE-010', name: '코스 편집', href: '/tech/route' },
  { code: 'T-RTE-020', name: '관할 내 미배정', href: '/tech/route/unassigned' },
  { code: 'T-RTE-030', name: '주간 일정', href: '/tech/route/week' },
  { code: 'T-CAL-010', name: '캘린더', href: '/tech/calendar' },
  { code: 'T-MEMO-010', name: '메모 등록', href: '/tech/memos/new' },
  { code: 'T-STL-010', name: '정산', href: '/tech/settlements' },
  { code: 'T-MAT-010', name: '보유 자재', href: '/tech/materials' },
  { code: 'T-MAT-020', name: '자재 요청', href: '/tech/materials/requests' },
  { code: 'T-EDU-010', name: '기술자료', href: '/tech/docs' },
  { code: 'T-EDU-020', name: '내 교육·등급', href: '/tech/education' },
  { code: 'T-NTC-010', name: '공지사항', href: '/tech/notices' },
  { code: 'T-NTF-010', name: '알림', href: '/tech/notifications' },
  { code: 'T-MY-010', name: '내 정보', href: '/tech/my' },
] as const;
export type TechQuickMenuCode = (typeof TECH_QUICK_MENUS)[number]['code'];

export const isTechQuickMenu = (code: string): code is TechQuickMenuCode => TECH_QUICK_MENUS.some((m) => m.code === code);
export const techQuickMenuOf = (code: string) => TECH_QUICK_MENUS.find((m) => m.code === code) ?? null;

/** 저장 전 정리: 모르는 화면·중복을 뺀다 (순서 유지) */
export function normalizeQuickMenu(codes: readonly string[]): TechQuickMenuCode[] {
  const out: TechQuickMenuCode[] = [];
  for (const c of codes) if (isTechQuickMenu(c) && !out.includes(c)) out.push(c);
  return out;
}

/** ★ 토글: 있으면 빼고, 없으면 맨 뒤에 넣는다 */
export function toggleQuickMenu(codes: readonly string[], code: string): TechQuickMenuCode[] {
  const cur = normalizeQuickMenu(codes);
  if (!isTechQuickMenu(code)) return cur;
  return cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
}

/** 순서 이동: from 위치의 메뉴를 to 위치로 (드래그·위/아래 버튼 공용) */
export function moveQuickMenu(codes: readonly string[], from: number, to: number): TechQuickMenuCode[] {
  const cur = normalizeQuickMenu(codes);
  if (from < 0 || from >= cur.length || to < 0 || to >= cur.length || from === to) return cur;
  const [item] = cur.splice(from, 1);
  cur.splice(to, 0, item!);
  return cur;
}

/* ---------- 주간 할일 (F-TEC-HOM-03) ---------- */

export interface WeeklyTodoDay {
  date: string;
  /** D-day · D+1 · D+2 */
  label: string;
  memo: number;
  material: number;
  job: number;
}

/** D-day~D+2 메모·자재·약속 건수. 약속은 취소 아닌 내 배정 작업(약속일 기준) */
export function weeklyTodo(i: {
  today: string;
  memos: readonly MemoLike[];
  materials: readonly { status: string; neededDate: string | null }[];
  jobs: readonly { date: string | null; status: string }[];
  days?: number;
}): WeeklyTodoDay[] {
  const n = i.days ?? 3;
  return Array.from({ length: n }, (_, k) => {
    const date = addDaysStr(i.today, k);
    return {
      date,
      label: k === 0 ? 'D-day' : `D+${k}`,
      memo: i.memos.filter((m) => memoOccursOn(m, date)).length,
      material: materialsDueOn(i.materials, date, i.today).length,
      job: i.jobs.filter((j) => j.date === date && j.status !== 'CANCELED').length,
    };
  });
}

/* ---------- 월 수입 (F-TEC-STL-03) ---------- */

/** 기준일이 속한 달부터 거꾸로 n개월 (오래된 달 먼저, YYYY-MM) */
export function recentMonths(today: string, n: number): string[] {
  const base = `${today.slice(0, 7)}-01`;
  return Array.from({ length: n }, (_, k) => addMonthsToDate(base, k - (n - 1)).slice(0, 7));
}

/** 회차 종료일(period_end)이 속한 달로 실지급을 더한다. 작성 중(정산서 없음)은 넣지 않는다 */
export function monthlyIncome(rows: readonly { periodEnd: string; netPay: number }[], months: readonly string[]): { month: string; amount: number; count: number }[] {
  return months.map((month) => {
    const inMonth = rows.filter((r) => r.periodEnd.slice(0, 7) === month);
    return { month, amount: inMonth.reduce((s, r) => s + r.netPay, 0), count: inMonth.length };
  });
}
