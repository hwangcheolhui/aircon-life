/**
 * 처리 콘솔·미처리 대기열 규칙 (단계 6-2: F-ADM-PRC-01·02·05·06, BR-031·041·043, 01 §3.1·§3.2).
 * 관리자 대리 입력도 기사와 같은 완료 검증(checkCompletion)을 거치고, 상태는 작업 전이표를 한 칸씩 지나간다.
 */
import { MSG } from '../messages';
import { type CompletionInput, checkCompletion } from './work-rules';
import { type WorkStatus, canTransitionWork } from './work-status';
import { needsOperatorConfirm } from './pending';

/** 대리 처리 저장(완료)이 되는 주문 상태: 출발 전 배정완료 ~ 작업중. 미처리는 재약속 뒤에 */
export const PROXY_COMPLETE_STATUSES = ['ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS'] as const;
/** 대리 미처리 저장이 되는 주문 상태 (기사 미처리 저장과 같음) */
export const PROXY_PENDING_STATUSES = ['ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS'] as const;

/**
 * 대리 처리 저장 때 작업이 DONE까지 지나갈 단계 (01 §3.2 전이표를 건너뛰지 않는다).
 * null(작업 건 없음) → READY → ON_THE_WAY → ARRIVED → IN_PROGRESS → DONE. 이미 끝났거나 미처리면 빈 배열.
 */
export function proxyWorkPath(from: WorkStatus | null): WorkStatus[] {
  const chain: WorkStatus[] = ['READY', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'DONE'];
  const start = from === null ? 0 : chain.indexOf(from) + 1;
  if (from !== null && start === 0) return [];
  const path = chain.slice(start);
  let cur: WorkStatus | null = from;
  for (const s of path) {
    if (!canTransitionWork(cur, s)) return [];
    cur = s;
  }
  return path;
}

/**
 * F-ADM-PRC-02 대리 처리 저장 검증: 기사 처리 저장과 같은 항목(BR-041 전·후 사진, BR-043 안전 확인, 결과, 처리 내용, 응답 전 추가요금)
 * + 방문 일시(미래 불가) + 작업 시간(1~720분) + 자재·할인 금액(0 이상 정수).
 */
export function checkProxyCompletion(
  i: Omit<CompletionInput, 'workStatus'> & {
    orderStatus: string;
    visitedAt: Date | null;
    now: Date;
    workMinutes: number | null;
    materialAmount: number;
    discountAmount: number;
  },
): { ok: boolean; problems: string[]; fieldErrors: Record<string, string> } {
  if (!(PROXY_COMPLETE_STATUSES as readonly string[]).includes(i.orderStatus))
    return {
      ok: false,
      problems: [
        i.orderStatus === 'PENDING'
          ? '미처리 주문은 미처리 대기열에서 재약속한 뒤에 처리할 수 있습니다.'
          : '지금 상태에서는 처리 저장을 할 수 없습니다.',
      ],
      fieldErrors: {},
    };
  const fieldErrors: Record<string, string> = {};
  if (!i.visitedAt) fieldErrors.visitedAt = MSG.required('방문 일시');
  else if (i.visitedAt.getTime() > i.now.getTime()) fieldErrors.visitedAt = '방문 일시는 지금보다 늦을 수 없습니다.';
  if (i.workMinutes === null || !Number.isInteger(i.workMinutes) || i.workMinutes < 1 || i.workMinutes > 720)
    fieldErrors.workMinutes = '작업 시간은 1~720분으로 입력해 주세요.';
  if (!Number.isInteger(i.materialAmount) || i.materialAmount < 0) fieldErrors.materialAmount = '자재 금액은 0원 이상이어야 합니다.';
  if (!Number.isInteger(i.discountAmount) || i.discountAmount < 0) fieldErrors.discountAmount = '할인 금액은 0원 이상이어야 합니다.';
  const c = checkCompletion({ ...i, workStatus: 'IN_PROGRESS' });
  const problems = c.problems.map((p) =>
    p.code === 'SAFETY' ? '안전 체크(기사 확인)를 표시해 주세요.' : p.message,
  );
  return { ok: problems.length === 0 && Object.keys(fieldErrors).length === 0, problems, fieldErrors };
}

/**
 * F-ADM-PRC-05 재약속 검증 (PENDING → ASSIGNED, 01 §3.1).
 * BR-031: 고객부재가 2회 연속이면 운영자가 고객과 확인했다는 표시와 확인 내용을 남겨야 재약속할 수 있다.
 */
export function checkReschedule(i: {
  orderStatus: string;
  absentStreak: number;
  operatorConfirmed: boolean;
  confirmMemo: string;
  slotDate: string;
  slotHour: number;
  today: string;
  hasMainTech: boolean;
}): Record<string, string> {
  if (i.orderStatus !== 'PENDING') return { form: '미처리 상태의 주문만 재약속할 수 있습니다.' };
  if (!i.hasMainTech) return { form: '주기사 배정이 없습니다. 배정 보드에서 기사를 먼저 정해 주세요.' };
  const e: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.slotDate)) e.slotDate = MSG.required('재약속 날짜');
  else if (i.slotDate < i.today) e.slotDate = '재약속 날짜는 오늘 이후로 골라 주세요.';
  if (!Number.isInteger(i.slotHour) || i.slotHour < 0 || i.slotHour > 23) e.slotHour = MSG.required('방문 시각');
  if (needsOperatorConfirm(i.absentStreak)) {
    if (!i.operatorConfirmed) e.operatorConfirmed = '고객부재가 2회 연속이라 운영자 확인이 필요합니다. 고객과 통화해 방문 가능 여부를 확인해 주세요.';
    if (!i.confirmMemo.trim()) e.confirmMemo = MSG.required('확인 내용');
  }
  return e;
}

/** A-PRC-010 기사 접수 목록 정렬 그룹: 이관 요청 → 미처리 → 진행(배정~작업중) → 처리(작업완료·완료, 하단 노란 배경) → 취소 */
export function consoleGroupOf(o: { status: string; transferRequested: boolean }): 0 | 1 | 2 | 3 | 4 {
  if (o.transferRequested) return 0;
  if (o.status === 'PENDING') return 1;
  if (['RECEIVED', 'ASSIGN_WAIT', 'ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS'].includes(o.status)) return 2;
  if (o.status === 'WORK_DONE' || o.status === 'COMPLETED') return 3;
  return 4;
}

export function sortConsoleRows<T extends { status: string; transferRequested: boolean; promisedAt: Date | null }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      consoleGroupOf(a) - consoleGroupOf(b) || (a.promisedAt?.getTime() ?? 0) - (b.promisedAt?.getTime() ?? 0),
  );
}

/** F-ADM-PRC-06 파일 첨부: 종류(안전관리 SAFETY · 서비스 DOC)마다 건당 2개까지 */
export const CONSOLE_FILE_KINDS = ['SAFETY', 'DOC'] as const;
export const CONSOLE_FILES_PER_KIND = 2;

export function checkConsoleFile(i: { kind: string; existing: number; size: number; maxBytes: number }): string | null {
  if (!(CONSOLE_FILE_KINDS as readonly string[]).includes(i.kind)) return MSG.required('파일 종류');
  if (i.existing >= CONSOLE_FILES_PER_KIND) return `파일은 종류마다 ${CONSOLE_FILES_PER_KIND}개까지 올릴 수 있습니다. 기존 파일을 지운 뒤 올려 주세요.`;
  if (i.size <= 0) return MSG.required('파일');
  if (i.size > i.maxBytes) return `파일이 너무 큽니다(${Math.floor(i.maxBytes / 1024 / 1024)}MB 이하).`;
  return null;
}
