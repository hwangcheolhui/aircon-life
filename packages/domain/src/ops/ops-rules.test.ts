import { describe, expect, it } from 'vitest';
import {
  addMonthsToDate,
  bucketOf,
  canWriteNotice,
  evaluateKpi,
  isPeakMonth,
  isPurgeDue,
  isRevisitTarget,
  kpiAsComplaintRate,
  kpiCac,
  kpiMargin,
  kpiNps,
  kpiOffPeakRatio,
  kpiRetention,
  kpiRevisitRate,
  matchConversion,
  noticeVisibleTo,
  purgeDueDateOf,
  sortNotices,
} from './ops-rules';

describe('재방문 자동 캠페인 (BR-091·BR-101, F-SYS-06)', () => {
  const base = { status: 'ACTIVE', marketingAgree: true, lastServiceDate: '2025-12-20', lastTargetedAt: null, hasActiveOrder: false };
  const cutoff = addMonthsToDate('2026-11-26', -11);
  it('기준일 = 오늘 − 11개월 (말일 보정)', () => {
    expect(cutoff).toBe('2025-12-26');
    expect(addMonthsToDate('2026-03-31', -1)).toBe('2026-02-28');
  });
  it('BR-091 최근 작업 후 11개월 지난 마케팅 동의 고객만 대상', () => {
    expect(isRevisitTarget({ ...base, cutoff })).toBe(true);
    expect(isRevisitTarget({ ...base, lastServiceDate: '2026-01-10', cutoff })).toBe(false);
    expect(isRevisitTarget({ ...base, lastServiceDate: null, cutoff })).toBe(false);
  });
  it('BR-101 마케팅 동의 철회 고객은 즉시 제외', () => {
    expect(isRevisitTarget({ ...base, marketingAgree: false, cutoff })).toBe(false);
  });
  it('탈퇴·파기 고객, 진행 중 주문이 있는 고객, 이번 작업 이후 이미 보낸 고객은 제외', () => {
    expect(isRevisitTarget({ ...base, status: 'WITHDRAWN', cutoff })).toBe(false);
    expect(isRevisitTarget({ ...base, hasActiveOrder: true, cutoff })).toBe(false);
    expect(isRevisitTarget({ ...base, lastTargetedAt: '2026-11-25', cutoff })).toBe(false);
    // 지난 시즌에 보냈어도 그 뒤에 다시 작업했으면 다시 대상
    expect(isRevisitTarget({ ...base, lastTargetedAt: '2025-11-01', cutoff })).toBe(true);
  });
  it('전환: 발송 후 N일 안에 접수한 첫 주문(취소 제외)', () => {
    const sentAt = new Date('2026-11-01T01:00:00Z');
    const orders = [
      { id: 1, createdAt: new Date('2026-10-30T00:00:00Z'), status: 'COMPLETED' },
      { id: 2, createdAt: new Date('2026-11-05T00:00:00Z'), status: 'CANCELED' },
      { id: 3, createdAt: new Date('2026-11-10T00:00:00Z'), status: 'RECEIVED' },
    ];
    expect(matchConversion(sentAt, orders, 60)).toBe(3);
    expect(matchConversion(sentAt, orders, 5)).toBeNull();
  });
});

describe('개인정보 파기 (F-SYS-12, ERD §6)', () => {
  it('탈퇴 고객은 탈퇴일 + 보관 연수, 그 외는 최종 거래일(없으면 가입일) + 보관 연수', () => {
    expect(purgeDueDateOf({ status: 'WITHDRAWN', withdrawnDate: '2026-02-28', lastServiceDate: '2025-01-01', createdDate: '2024-01-01' }, 5)).toBe('2031-02-28');
    expect(purgeDueDateOf({ status: 'ACTIVE', withdrawnDate: null, lastServiceDate: '2026-11-26', createdDate: '2024-01-01' }, 5)).toBe('2031-11-26');
    expect(purgeDueDateOf({ status: 'ACTIVE', withdrawnDate: null, lastServiceDate: null, createdDate: '2024-02-29' }, 5)).toBe('2029-02-28');
  });
  it('예정일이 오늘 이전이고 아직 파기 전이면 대상', () => {
    expect(isPurgeDue({ status: 'WITHDRAWN', purgeDueDate: '2026-11-26' }, '2026-11-26')).toBe(true);
    expect(isPurgeDue({ status: 'WITHDRAWN', purgeDueDate: '2026-11-27' }, '2026-11-26')).toBe(false);
    expect(isPurgeDue({ status: 'PURGED', purgeDueDate: '2020-01-01' }, '2026-11-26')).toBe(false);
    expect(isPurgeDue({ status: 'ACTIVE', purgeDueDate: null }, '2026-11-26')).toBe(false);
  });
});

describe('공지 (F-ADM-CNT-01, F-TEC-HOM-01)', () => {
  const now = new Date('2026-11-26T03:00:00Z');
  const n = { noticeType: 'ALL', targetAudience: 'TECHNICIAN', branchId: null, publishFrom: new Date('2026-11-01T00:00:00Z'), publishTo: null };
  const tech = { kind: 'TECHNICIAN' as const, branchId: 10 };
  it('게시 기간 안 + 대상(기사·전체)일 때만 기사에게 보인다', () => {
    expect(noticeVisibleTo(n, tech, now)).toBe(true);
    expect(noticeVisibleTo({ ...n, targetAudience: 'ADMIN' }, tech, now)).toBe(false);
    expect(noticeVisibleTo({ ...n, targetAudience: 'ALL' }, tech, now)).toBe(true);
    expect(noticeVisibleTo({ ...n, publishFrom: new Date('2026-12-01T00:00:00Z') }, tech, now)).toBe(false);
    expect(noticeVisibleTo({ ...n, publishTo: new Date('2026-11-25T00:00:00Z') }, tech, now)).toBe(false);
  });
  it('거점 공지는 그 거점 소속에게만, 고객 공지는 기사에게 안 보인다', () => {
    expect(noticeVisibleTo({ ...n, noticeType: 'BRANCH', branchId: 10 }, tech, now)).toBe(true);
    expect(noticeVisibleTo({ ...n, noticeType: 'BRANCH', branchId: 20 }, tech, now)).toBe(false);
    expect(noticeVisibleTo({ ...n, noticeType: 'CUSTOMER', targetAudience: 'CUSTOMER' }, tech, now)).toBe(false);
    expect(noticeVisibleTo({ ...n, noticeType: 'CUSTOMER', targetAudience: 'CUSTOMER' }, { kind: 'CUSTOMER', branchId: null }, now)).toBe(true);
  });
  it('BR-102 거점 소속 관리자는 자기 거점 공지만 쓸 수 있다', () => {
    expect(canWriteNotice({ kind: 'ALL' }, { noticeType: 'ALL', branchId: null })).toBeNull();
    expect(canWriteNotice({ kind: 'BRANCH', branchId: 10 }, { noticeType: 'BRANCH', branchId: 10 })).toBeNull();
    expect(canWriteNotice({ kind: 'BRANCH', branchId: 10 }, { noticeType: 'ALL', branchId: null })).toBe('거점 소속 관리자는 자기 거점 공지만 등록할 수 있습니다.');
    expect(canWriteNotice({ kind: 'BRANCH', branchId: 10 }, { noticeType: 'BRANCH', branchId: 20 })).toBe('거점 소속 관리자는 자기 거점 공지만 등록할 수 있습니다.');
    expect(canWriteNotice({ kind: 'ALL' }, { noticeType: 'BRANCH', branchId: null })).toBe('거점은 필수 입력값입니다.');
  });
  it('상단 고정 먼저, 그다음 게시 시작 최신 순', () => {
    const list = [
      { id: 1, isPinned: false, publishFrom: new Date('2026-11-20') },
      { id: 2, isPinned: true, publishFrom: new Date('2026-11-01') },
      { id: 3, isPinned: false, publishFrom: new Date('2026-11-25') },
    ];
    expect(sortNotices(list).map((x) => x.id)).toEqual([2, 3, 1]);
  });
});

describe('KPI 산출 (ERD §5, F-ADM-DSH-02)', () => {
  it('객단가·마진율 = (매출 − 정산 지급 − 자재원가) ÷ 매출', () => {
    expect(kpiMargin({ revenue: 1_000_000, jobs: 10, techPay: 550_000, materialCost: 50_000 })).toEqual({ avgTicket: 100_000, marginRate: 40 });
    expect(kpiMargin({ revenue: 0, jobs: 0, techPay: 0, materialCost: 0 })).toEqual({ avgTicket: null, marginRate: null });
  });
  it('재방문율 = 전년 동기 완료 고객 중 금년 재주문 고객 비율', () => {
    expect(kpiRevisitRate({ baseCustomers: [1, 2, 3, 4], reorderedCustomers: [2, 4, 9] })).toBe(50);
    expect(kpiRevisitRate({ baseCustomers: [], reorderedCustomers: [1] })).toBeNull();
  });
  it('기사 6개월 정착률 = 입사 6개월 지난 기사 중 이탈(LEFT) 아닌 비율', () => {
    const techs = [
      { joinedAt: '2026-01-10', status: 'ACTIVE' },
      { joinedAt: '2026-02-01', status: 'LEFT' },
      { joinedAt: '2026-05-01', status: 'PAUSED' },
      { joinedAt: '2026-09-01', status: 'LEFT' }, // 6개월 안 됨 → 제외
      { joinedAt: null, status: 'ACTIVE' },
    ];
    expect(kpiRetention(techs, '2026-11-26')).toBeCloseTo(66.7, 1);
    expect(kpiRetention([], '2026-11-26')).toBeNull();
  });
  it('비수기/성수기 매출 비 = 9~4월 월평균 ÷ 5~8월 월평균', () => {
    expect(isPeakMonth(5)).toBe(true);
    expect(isPeakMonth(9)).toBe(false);
    const months = [
      { month: '2026-05', revenue: 100 },
      { month: '2026-06', revenue: 300 },
      { month: '2026-09', revenue: 40 },
      { month: '2026-10', revenue: 120 },
    ];
    expect(kpiOffPeakRatio(months)).toBe(40);
    expect(kpiOffPeakRatio([{ month: '2026-09', revenue: 10 }])).toBeNull();
  });
  it('AS·불만율 = (AS + 불만 VOC) ÷ 완료 건수', () => {
    expect(kpiAsComplaintRate({ asCount: 2, complaintCount: 3, completed: 100 })).toBe(5);
    expect(kpiAsComplaintRate({ asCount: 2, complaintCount: 3, completed: 0 })).toBeNull();
  });
  it('CAC = 마케팅비 ÷ 신규 고객, 객단가 대비 비율', () => {
    expect(kpiCac({ marketingCost: 300_000, newCustomers: 20, avgTicket: 100_000 })).toEqual({ cac: 15_000, cacRate: 15 });
    expect(kpiCac({ marketingCost: null, newCustomers: 20, avgTicket: 100_000 })).toEqual({ cac: null, cacRate: null });
  });
  it('NPS = (9~10점 비율 − 0~6점 비율) × 100', () => {
    expect(kpiNps([10, 9, 8, 7, 3])).toBe(20);
    expect(kpiNps([])).toBeNull();
  });
  it('목표 대비 판정 (높을수록 좋음 / 낮을수록 좋음)', () => {
    expect(evaluateKpi(160, 150, 'HIGHER')).toBe('MET');
    expect(evaluateKpi(120, 150, 'HIGHER')).toBe('BELOW');
    expect(evaluateKpi(4.5, 5, 'LOWER')).toBe('MET');
    expect(evaluateKpi(6, 5, 'LOWER')).toBe('BELOW');
    expect(evaluateKpi(null, 5, 'LOWER')).toBe('NA');
  });
});

describe('매출 통계 묶음 (F-ADM-STA-01)', () => {
  it('일·주(ISO)·월 단위 키', () => {
    expect(bucketOf('2026-11-26', 'DAY')).toBe('2026-11-26');
    expect(bucketOf('2026-11-26', 'WEEK')).toBe('2026-W48');
    expect(bucketOf('2026-01-01', 'WEEK')).toBe('2026-W01');
    expect(bucketOf('2026-11-26', 'MONTH')).toBe('2026-11');
  });
});
