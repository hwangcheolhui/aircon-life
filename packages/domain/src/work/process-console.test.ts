import { describe, expect, it } from 'vitest';
import {
  CONSOLE_FILES_PER_KIND,
  checkConsoleFile,
  checkProxyCompletion,
  checkReschedule,
  consoleGroupOf,
  proxyWorkPath,
  sortConsoleRows,
} from './process-console';

describe('F-ADM-PRC-02 대리 처리 저장: 작업 전이표를 한 칸씩 지나간다(01 §3.2)', () => {
  it('작업 건이 없거나 출발 전·이동중·작업중이면 DONE까지의 남은 단계를 돌려준다', () => {
    expect(proxyWorkPath(null)).toEqual(['READY', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'DONE']);
    expect(proxyWorkPath('READY')).toEqual(['ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'DONE']);
    expect(proxyWorkPath('ON_THE_WAY')).toEqual(['ARRIVED', 'IN_PROGRESS', 'DONE']);
    expect(proxyWorkPath('IN_PROGRESS')).toEqual(['DONE']);
  });

  it('예외: 이미 끝났거나 미처리·취소면 지나갈 길이 없다', () => {
    expect(proxyWorkPath('DONE')).toEqual([]);
    expect(proxyWorkPath('PENDING')).toEqual([]);
    expect(proxyWorkPath('CANCELED')).toEqual([]);
  });
});

describe('F-ADM-PRC-02 대리 처리 저장 검증 (BR-041 · BR-043)', () => {
  const unit = { orderItemId: 1, unitNo: 1, label: '벽걸이 1' };
  const now = new Date('2026-11-24T06:00:00Z');
  const ok = {
    orderStatus: 'ASSIGNED',
    units: [unit],
    results: [{ orderItemId: 1, unitNo: 1, result: 'DONE' }],
    photos: [
      { orderItemId: 1, unitNo: 1, photoType: 'BEFORE' },
      { orderItemId: 1, unitNo: 1, photoType: 'AFTER' },
    ],
    safetyDone: true,
    pendingExtraCharges: 0,
    workNote: '필터·열교환기 세척 완료',
    noteMinLength: 10,
    visitedAt: new Date('2026-11-24T02:00:00Z'),
    now,
    workMinutes: 60,
    materialAmount: 0,
    discountAmount: 0,
  };

  it('결과·사진·안전 확인·처리 내용·방문 일시·작업 시간이 있으면 저장된다', () => {
    expect(checkProxyCompletion(ok)).toEqual({ ok: true, problems: [], fieldErrors: {} });
  });

  it('BR-041 예외: 작업한 기기의 전·후 사진이 없으면 막는다', () => {
    const r = checkProxyCompletion({ ...ok, photos: [] });
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('벽걸이 1 작업 전 사진이 없습니다.');
    expect(r.problems).toContain('벽걸이 1 작업 후 사진이 없습니다.');
  });

  it('BR-043 예외: 안전 체크 확인이 없으면 막는다', () => {
    expect(checkProxyCompletion({ ...ok, safetyDone: false }).problems).toContain('안전 체크(기사 확인)를 표시해 주세요.');
  });

  it('예외: 방문 일시가 미래이거나 작업 시간이 범위를 벗어나면 막는다', () => {
    const r = checkProxyCompletion({ ...ok, visitedAt: new Date('2026-11-24T07:00:00Z'), workMinutes: 0 });
    expect(r.fieldErrors.visitedAt).toBe('방문 일시는 지금보다 늦을 수 없습니다.');
    expect(r.fieldErrors.workMinutes).toBeTruthy();
    expect(checkProxyCompletion({ ...ok, visitedAt: null }).fieldErrors.visitedAt).toBe('방문 일시는 필수 입력값입니다.');
    expect(checkProxyCompletion({ ...ok, materialAmount: -1 }).fieldErrors.materialAmount).toBeTruthy();
  });

  it('예외: 미처리 주문은 재약속 뒤에, 작업완료 주문은 처리 저장 불가', () => {
    expect(checkProxyCompletion({ ...ok, orderStatus: 'PENDING' }).problems[0]).toContain('재약속');
    expect(checkProxyCompletion({ ...ok, orderStatus: 'WORK_DONE' }).ok).toBe(false);
  });
});

describe('BR-031 고객부재 2회 연속이면 운영자 확인 후에만 재약속 (F-ADM-PRC-05)', () => {
  const base = {
    orderStatus: 'PENDING',
    absentStreak: 0,
    operatorConfirmed: false,
    confirmMemo: '',
    slotDate: '2026-11-26',
    slotHour: 10,
    today: '2026-11-24',
    hasMainTech: true,
  };

  it('미처리 주문은 날짜·시각을 골라 재약속한다', () => {
    expect(checkReschedule(base)).toEqual({});
    expect(checkReschedule({ ...base, absentStreak: 1 })).toEqual({});
  });

  it('BR-031 고객부재 2회 연속이면 운영자 확인 표시와 확인 내용이 있어야 한다', () => {
    const e = checkReschedule({ ...base, absentStreak: 2 });
    expect(e.operatorConfirmed).toContain('운영자 확인');
    expect(e.confirmMemo).toBe('확인 내용은 필수 입력값입니다.');
    expect(checkReschedule({ ...base, absentStreak: 2, operatorConfirmed: true, confirmMemo: '고객 통화, 26일 오전 재방문 약속' })).toEqual({});
  });

  it('예외: 지난 날짜·미처리가 아닌 주문·주기사 없음은 막는다', () => {
    expect(checkReschedule({ ...base, slotDate: '2026-11-23' }).slotDate).toBeTruthy();
    expect(checkReschedule({ ...base, orderStatus: 'ASSIGNED' }).form).toBeTruthy();
    expect(checkReschedule({ ...base, hasMainTech: false }).form).toContain('배정 보드');
  });
});

describe('F-ADM-PRC-01 기사 접수 목록 순서: 이관 → 미처리 → 진행 → 처리', () => {
  it('그룹 순서대로, 같은 그룹은 약속 시각 순으로 정렬한다', () => {
    const d = (h: number) => new Date(`2026-11-24T0${h}:00:00Z`);
    const rows = [
      { id: 1, status: 'COMPLETED', transferRequested: false, promisedAt: d(1) },
      { id: 2, status: 'ASSIGNED', transferRequested: false, promisedAt: d(3) },
      { id: 3, status: 'PENDING', transferRequested: false, promisedAt: d(2) },
      { id: 4, status: 'ASSIGNED', transferRequested: true, promisedAt: d(4) },
      { id: 5, status: 'ASSIGNED', transferRequested: false, promisedAt: d(2) },
    ];
    expect(sortConsoleRows(rows).map((r) => r.id)).toEqual([4, 3, 5, 2, 1]);
    expect(consoleGroupOf({ status: 'WORK_DONE', transferRequested: false })).toBe(3);
  });
});

describe('F-ADM-PRC-06 파일 첨부: 종류마다 2개까지', () => {
  it('안전관리·서비스 파일을 종류마다 2개까지 올린다', () => {
    expect(CONSOLE_FILES_PER_KIND).toBe(2);
    expect(checkConsoleFile({ kind: 'SAFETY', existing: 1, size: 100, maxBytes: 1000 })).toBeNull();
  });

  it('예외: 3개째·빈 파일·너무 큰 파일·모르는 종류는 막는다', () => {
    expect(checkConsoleFile({ kind: 'DOC', existing: 2, size: 100, maxBytes: 1000 })).toContain('2개까지');
    expect(checkConsoleFile({ kind: 'DOC', existing: 0, size: 0, maxBytes: 1000 })).toBe('파일은 필수 입력값입니다.');
    expect(checkConsoleFile({ kind: 'DOC', existing: 0, size: 2000, maxBytes: 1000 })).toContain('너무 큽니다');
    expect(checkConsoleFile({ kind: 'X', existing: 0, size: 1, maxBytes: 1000 })).toBeTruthy();
  });
});
