import { describe, expect, it } from 'vitest';
import { findDuplicateOrders } from '../order/order-rules';
import { assertOrderTransition } from '../order/order-status';
import {
  availableTechnicians,
  buildTimeTable,
  canWithdrawPrivacy,
  consentAnswerToStatus,
  consoleAlerts,
  needsConsentPrompt,
  onCallTechnicians,
  phoneOrderStatusPath,
  shiftDate,
  timeTableDates,
  validatePromisedAt,
  visitSurchargeNotice,
} from './console-rules';
import { assertConsultTransition, canTransitionConsult, formatConsultNo } from './consult-status';

const now = new Date('2027-03-10T01:00:00Z'); // 한국 10:00 (수)

describe('BR-023 개인정보 동의 팝업 (A-CSL-013)', () => {
  it('BR-023 질의못함(NOT_ASKED) 고객은 동의 팝업을 자동으로 띄운다', () => {
    expect(needsConsentPrompt({ status: 'NOT_ASKED', lastAnsweredAt: new Date('2027-03-01'), now, reaskMonths: 12 })).toBe(true);
  });
  it('BR-023 미동의 고객은 재질의 주기(12개월)가 지나면 다시 묻는다', () => {
    expect(needsConsentPrompt({ status: 'DISAGREED', lastAnsweredAt: new Date('2026-03-01'), now, reaskMonths: 12 })).toBe(true);
  });
  it('BR-023 예외: 미동의 후 재질의 주기 전이면 묻지 않는다', () => {
    expect(needsConsentPrompt({ status: 'DISAGREED', lastAnsweredAt: new Date('2026-12-01'), now, reaskMonths: 12 })).toBe(false);
  });
  it('BR-023 예외: 동의 고객은 묻지 않고 철회 버튼만 보인다', () => {
    expect(needsConsentPrompt({ status: 'AGREED', lastAnsweredAt: null, now, reaskMonths: 12 })).toBe(false);
    expect(canWithdrawPrivacy('AGREED')).toBe(true);
    expect(canWithdrawPrivacy('NOT_ASKED')).toBe(false);
  });
  it('응답 → 고객 동의 상태: 철회는 미동의가 된다', () => {
    expect(consentAnswerToStatus('AGREE')).toBe('AGREED');
    expect(consentAnswerToStatus('DISAGREE')).toBe('DISAGREED');
    expect(consentAnswerToStatus('NOT_ASKED')).toBe('NOT_ASKED');
    expect(consentAnswerToStatus('WITHDRAW')).toBe('DISAGREED');
  });
});

describe('BR-022 고객 선택 시 Alert (F-ADM-CSL-04)', () => {
  it('BR-022 미완료 상담 → 미완료 클레임 → 당일 상담 순서로 Alert 한다', () => {
    const a = consoleAlerts({ openConsults: 1, openClaims: 2, todayConsults: 3 });
    expect(a.map((x) => x.kind)).toEqual(['OPEN_CONSULT', 'OPEN_CLAIM', 'TODAY_CONSULT']);
    expect(a[1]!.message).toContain('2건');
  });
  it('BR-022 예외: 해당 이력이 없으면 Alert 하지 않는다', () => {
    expect(consoleAlerts({ openConsults: 0, openClaims: 0, todayConsults: 0 })).toEqual([]);
    expect(consoleAlerts({ openConsults: 0, openClaims: 0, todayConsults: 1 }).map((x) => x.kind)).toEqual(['TODAY_CONSULT']);
  });
});

describe('BR-024 출장접수 저장 상태 (F-ADM-CSL-05·07)', () => {
  it('BR-024 기사 미선택 저장은 배정대기(미지정·긴급) 상태가 된다', () => {
    const path = phoneOrderStatusPath({ technicianSelected: false, requiredTechCount: 1 });
    expect(path).toEqual(['ASSIGN_WAIT']);
    expect(() => assertOrderTransition(null, path[0]!)).not.toThrow();
  });
  it('BR-024 예외: 기사를 고르면 접수 → 배정완료로 저장된다(상태 이력 2행)', () => {
    const path = phoneOrderStatusPath({ technicianSelected: true, requiredTechCount: 1 });
    expect(path).toEqual(['RECEIVED', 'ASSIGNED']);
    expect(() => assertOrderTransition(null, 'RECEIVED')).not.toThrow();
    expect(() => assertOrderTransition('RECEIVED', 'ASSIGNED')).not.toThrow();
  });
  it('BR-024 예외: 2인 방문 건은 주기사를 골라도 지원기사가 붙기 전까지 배정대기', () => {
    expect(phoneOrderStatusPath({ technicianSelected: true, requiredTechCount: 2 })).toEqual(['ASSIGN_WAIT']);
  });
});

describe('BR-020 이중접수 확인 (F-ADM-CSL-10, A-CSL-024)', () => {
  const orders = [
    { orderNo: 'A', status: 'ASSIGN_WAIT', phoneHash: 'h1', addressKey: 'x' },
    { orderNo: 'B', status: 'COMPLETED', phoneHash: 'h1', addressKey: 'x' },
  ];
  it('BR-020 같은 전화번호의 미완료 주문이 있으면 이중접수 리스트에 띄운다', () => {
    expect(findDuplicateOrders(orders, { phoneHash: 'h1', addressKey: null }).map((o) => o.orderNo)).toEqual(['A']);
  });
  it('BR-020 예외: 다른 번호·다른 주소면 이중접수가 아니다', () => {
    expect(findDuplicateOrders(orders, { phoneHash: 'h2', addressKey: 'y' })).toEqual([]);
  });
});

describe('BR-011·012 약속일시 할증 안내 (F-ADM-CSL-09)', () => {
  it('BR-011 평일 야간 약속은 야간 할증 금액을 안내한다', () => {
    expect(visitSurchargeNotice({ ruleCode: 'NIGHT', amount: 30000 })).toBe('[평일 야간 약속 안내] 야간 방문 시 할증 30,000원이 추가됩니다.');
  });
  it('BR-012 토·일·공휴일 약속은 휴일 할증 금액을 안내한다', () => {
    expect(visitSurchargeNotice({ ruleCode: 'HOLIDAY', amount: 30000 })).toContain('[휴일 약속 안내]');
  });
  it('BR-011 예외: 업무시간 약속은 안내하지 않는다', () => {
    expect(visitSurchargeNotice(null)).toBeNull();
  });
  it('지난 일시는 "약속일시의 일자 정보가 잘못되었습니다."', () => {
    expect(validatePromisedAt('2027-03-10', 9, now)).toBe('약속일시의 일자 정보가 잘못되었습니다.');
    expect(validatePromisedAt('2027-03-10', 11, now)).toBeNull();
  });
});

describe('F-ADM-CSL-06 Time Table', () => {
  it('7일 × 시간대 잔여 건수와 계약·긴급·당직 열을 만든다', () => {
    const dates = timeTableDates('2027-03-10');
    expect(dates).toHaveLength(7);
    expect(shiftDate('2027-03-10', 7)).toBe('2027-03-17');
    const rows = buildTimeTable({
      dates,
      holidays: ['2027-03-11'],
      now,
      slots: [
        { slotDate: '2027-03-10', slotHour: 9, slotKind: 'NORMAL', capacity: 2, bookedCount: 1, isClosed: false },
        { slotDate: '2027-03-10', slotHour: 14, slotKind: 'NORMAL', capacity: 2, bookedCount: 0, isClosed: true },
        { slotDate: '2027-03-10', slotHour: 9, slotKind: 'ON_CALL', capacity: 1, bookedCount: 0, isClosed: false },
      ],
    });
    const first = rows[0]!;
    expect(first.cells.find((c) => c.hour === 9)).toMatchObject({ remaining: 1, past: true });
    expect(first.cells.find((c) => c.hour === 14)).toMatchObject({ remaining: 0, past: false });
    expect(first.cells.find((c) => c.hour === 10)?.remaining).toBeNull();
    expect(first.onCall).toBe(1);
    expect(rows[1]!.holiday).toBe(true);
  });
});

describe('F-ADM-CSL-07·08 출장 가능·휴일 당직 기사', () => {
  const defaults = { defaultStart: '09:00', defaultEnd: '18:00' };
  const techs = [
    { id: 1, name: '김기사', grade: 'REGULAR' },
    { id: 2, name: '이기사', grade: 'LEADER' },
    { id: 3, name: '박기사', grade: 'TRAINEE' },
    { id: 4, name: '최기사', grade: 'REGULAR' },
  ];
  const schedules = [
    { technicianId: 1, workDate: '2027-03-12', scheduleType: 'WORK', startTime: null, endTime: null },
    { technicianId: 2, workDate: '2027-03-12', scheduleType: 'WORK', startTime: null, endTime: null },
    { technicianId: 3, workDate: '2027-03-12', scheduleType: 'HALF_PM', startTime: null, endTime: null },
    { technicianId: 4, workDate: '2027-03-12', scheduleType: 'OFF', startTime: null, endTime: null },
  ];
  it('근무 중이고 약속이 겹치지 않는 기사만 선택할 수 있다', () => {
    const r = availableTechnicians({ techs, schedules, busy: [{ technicianId: 2, fromHour: 14, toHour: 16 }], startHour: 15, needHours: 1, defaults });
    expect(r.map((t) => [t.name, t.available, t.reason])).toEqual([
      ['김기사', true, null],
      ['박기사', false, 'NOT_WORKING_HOURS'],
      ['이기사', false, 'BUSY'],
    ]);
  });
  it('휴무 기사는 목록에 나오지 않고, 당직 기사는 휴일 근무 기사로 나온다', () => {
    const onCall = onCallTechnicians(techs, [{ technicianId: 4, workDate: '2027-03-13', scheduleType: 'ON_CALL', startTime: null, endTime: null }], '2027-03-13');
    expect(onCall.map((t) => t.name)).toEqual(['최기사']);
  });
});

describe('상담 상태 (01 §3.5)', () => {
  it('OPEN → IN_PROGRESS → DONE, 통화 중 끝난 상담은 바로 DONE 으로 만든다', () => {
    expect(canTransitionConsult(null, 'DONE')).toBe(true);
    expect(canTransitionConsult('OPEN', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionConsult('IN_PROGRESS', 'DONE')).toBe(true);
  });
  it('예외: 끝난 상담은 다시 열 수 없다', () => {
    expect(() => assertConsultTransition('DONE', 'OPEN')).toThrow();
    expect(canTransitionConsult(null, 'IN_PROGRESS')).toBe(false);
  });
  it('상담 번호는 J + 한국 날짜 + 4자리', () => {
    expect(formatConsultNo(new Date('2026-11-22T15:30:00Z'), 1)).toBe('J2611230001');
  });
});
