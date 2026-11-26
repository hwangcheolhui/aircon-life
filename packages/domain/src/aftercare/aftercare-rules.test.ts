import { describe, expect, it } from 'vitest';
import {
  AS_TRANSITIONS,
  VOC_TRANSITIONS,
  asWarrantyOf,
  assertAsTransition,
  assertFollowupTransition,
  assertIncidentTransition,
  assertVocTransition,
  autoIncidentRecipients,
  canRequestAs,
  checkFollowupInput,
  checkIncidentInput,
  checkVocClose,
  claimCategoryOf,
  defaultVocAlert,
  formatAfterNo,
  followupReceiverOf,
  needsEscalation,
  nextFollowupCount,
  parseMediaFlags,
  revisitOrderItems,
} from './aftercare-rules';
import { MSG } from '../messages';

const d = (s: string) => new Date(s);

describe('AS 보증 판정 (BR-050)', () => {
  it('BR-050 완료일로부터 보증기간(30일) 안이면 무상', () => {
    const r = asWarrantyOf({ completedAt: d('2026-11-01T10:00:00+09:00'), warrantyDays: [30], now: d('2026-11-30T23:00:00+09:00') });
    expect(r.isWarranty).toBe(true);
    expect(r.until).toBe('2026-12-01');
  });
  it('BR-050 보증기간이 지나면 유상', () => {
    const r = asWarrantyOf({ completedAt: d('2026-10-01T10:00:00+09:00'), warrantyDays: [30], now: d('2026-11-01T09:00:00+09:00') });
    expect(r.isWarranty).toBe(false);
  });
  it('BR-050 상품이 여러 개면 가장 긴 보증기간, 상품 정보가 없으면 30일', () => {
    expect(asWarrantyOf({ completedAt: d('2026-10-01T10:00:00+09:00'), warrantyDays: [30, 90], now: d('2026-12-15T09:00:00+09:00') }).isWarranty).toBe(true);
    expect(asWarrantyOf({ completedAt: d('2026-10-01T10:00:00+09:00'), warrantyDays: [], now: d('2026-10-20T09:00:00+09:00') }).until).toBe('2026-10-31');
  });
  it('BR-050 완료일이 없으면 보증 판정 불가(유상)', () => {
    expect(asWarrantyOf({ completedAt: null, warrantyDays: [30], now: d('2026-10-20T09:00:00+09:00') }).isWarranty).toBe(false);
  });
  it('BR-050 무상이면 재방문 주문 금액 0원, 유상이면 원 주문 스냅샷 단가', () => {
    const items = [
      { itemType: 'PRODUCT', productId: 1, quantity: 2, unitPrice: 50000 },
      { itemType: 'SURCHARGE', productId: null, quantity: 1, unitPrice: 10000 },
      { itemType: 'DISCOUNT', productId: null, quantity: 1, unitPrice: -5000 },
    ];
    const free = revisitOrderItems(items, true);
    expect(free).toEqual([{ itemType: 'PRODUCT', productId: 1, quantity: 2, unitPrice: 0, amount: 0 }]);
    const paid = revisitOrderItems(items, false);
    expect(paid).toEqual([{ itemType: 'PRODUCT', productId: 1, quantity: 2, unitPrice: 50000, amount: 100000 }]);
  });
});

describe('AS 요청 가능 여부 (F-CUS-AS-01)', () => {
  it('작업완료·완료 주문에서 진행 중 AS가 없을 때만', () => {
    expect(canRequestAs({ orderStatus: 'COMPLETED', orderType: 'NORMAL', openAsCount: 0 })).toEqual({ ok: true });
    expect(canRequestAs({ orderStatus: 'WORK_DONE', orderType: 'NORMAL', openAsCount: 0 })).toEqual({ ok: true });
    expect(canRequestAs({ orderStatus: 'ASSIGNED', orderType: 'NORMAL', openAsCount: 0 }).ok).toBe(false);
    expect(canRequestAs({ orderStatus: 'COMPLETED', orderType: 'NORMAL', openAsCount: 1 }).ok).toBe(false);
  });
  it('AS 재방문 주문에서는 다시 AS를 신청할 수 있다(원 주문 기준이 아니라 AS 주문 기준)', () => {
    expect(canRequestAs({ orderStatus: 'COMPLETED', orderType: 'AS', openAsCount: 0 }).ok).toBe(true);
  });
});

describe('AS 상태 전이 (01 §3.12)', () => {
  it('접수 → 승인 → 재방문 예정 → 완료, 접수·승인에서 반려', () => {
    expect(AS_TRANSITIONS.REQUESTED).toEqual(['ACCEPTED', 'REJECTED']);
    expect(() => assertAsTransition('ACCEPTED', 'SCHEDULED')).not.toThrow();
    expect(() => assertAsTransition('SCHEDULED', 'DONE')).not.toThrow();
    expect(() => assertAsTransition('ACCEPTED', 'REJECTED')).not.toThrow();
  });
  it('완료·반려 후에는 바꿀 수 없고, 승인 없이 재방문 예정으로 갈 수 없다', () => {
    expect(() => assertAsTransition('DONE', 'REJECTED')).toThrow();
    expect(() => assertAsTransition('REQUESTED', 'SCHEDULED')).toThrow();
    expect(() => assertAsTransition(null, 'REQUESTED')).not.toThrow();
    expect(() => assertAsTransition(null, 'ACCEPTED')).toThrow();
  });
});

describe('VOC (F-ADM-VOC-01)', () => {
  it('상태 전이: 접수 → 확정중 → 처리중 → 완료(건너뛰기 허용), 완료 후 변경 불가', () => {
    expect(VOC_TRANSITIONS.RECEIVED).toEqual(['CONFIRMING', 'PROCESSING', 'DONE']);
    expect(() => assertVocTransition('CONFIRMING', 'DONE')).not.toThrow();
    expect(() => assertVocTransition('DONE', 'PROCESSING')).toThrow();
    expect(() => assertVocTransition('PROCESSING', 'RECEIVED')).toThrow();
  });
  it('불만(COMPLAINT) 완료는 원인·고객 조치가 필수, 칭찬·제안은 아님', () => {
    expect(checkVocClose({ vocType: 'COMPLAINT', rootCause: '', customerAction: '재방문' })).toBe(MSG.required('원인'));
    expect(checkVocClose({ vocType: 'COMPLAINT', rootCause: '세척 누락', customerAction: ' ' })).toBe(MSG.required('고객 조치'));
    expect(checkVocClose({ vocType: 'COMPLAINT', rootCause: '세척 누락', customerAction: '재방문' })).toBeNull();
    expect(checkVocClose({ vocType: 'PRAISE', rootCause: null, customerAction: null })).toBeNull();
  });
  it('등급 HIGH 는 기본 경보', () => {
    expect(defaultVocAlert('HIGH')).toBe(true);
    expect(defaultVocAlert('MID')).toBe(false);
    expect(defaultVocAlert(null)).toBe(false);
  });
  it('상담 클레임 세부 유형 → VOC 대/중분류', () => {
    expect(claimCategoryOf('QUALITY')).toEqual({ l: 'QUALITY', m: 'QUALITY_DIRT' });
    expect(claimCategoryOf('ATTITUDE')).toEqual({ l: 'ATTITUDE', m: 'ATTITUDE_RUDE' });
    expect(claimCategoryOf('EXTRA_CHARGE')).toEqual({ l: 'PRICE', m: 'PRICE_EXTRA' });
    expect(claimCategoryOf('DELAY')).toEqual({ l: 'SCHEDULE', m: 'SCHEDULE_DELAY' });
    expect(claimCategoryOf('PRICE')).toEqual({ l: 'ETC', m: null });
  });
});

describe('안전사고 (BR-060·061)', () => {
  it('BR-060 언론·인터넷이 하나라도 있으면 경영진 보고 대상', () => {
    expect(needsEscalation(['POLICE'])).toBe(false);
    expect(needsEscalation(['POLICE', 'INTERNET'])).toBe(true);
    expect(needsEscalation(['PRESS'])).toBe(true);
    expect(needsEscalation([])).toBe(false);
  });
  it('매체/기관 문자열 ↔ 목록 (모르는 코드는 버림)', () => {
    expect(parseMediaFlags('PRESS,ETC,  ,WHAT')).toEqual(['PRESS', 'ETC']);
    expect(parseMediaFlags(null)).toEqual([]);
  });
  it('BR-061 거점장·담당자 자동 수신자, BR-060 보고 대상이면 경영진 추가 (같은 사람은 한 번만)', () => {
    const admins = [
      { id: 1, roleCode: 'ADM_BRANCH', branchId: 10 },
      { id: 2, roleCode: 'ADM_OPS', branchId: 10 },
      { id: 3, roleCode: 'ADM_OPS', branchId: 20 },
      { id: 4, roleCode: 'ADM_SUPER', branchId: null },
      { id: 5, roleCode: 'ADM_CS', branchId: 10 },
    ];
    expect(autoIncidentRecipients({ branchId: 10, admins, escalated: false })).toEqual([
      { adminUserId: 1, recipientType: 'BRANCH_MANAGER' },
      { adminUserId: 2, recipientType: 'OWNER' },
    ]);
    expect(autoIncidentRecipients({ branchId: 10, admins, escalated: true })).toEqual([
      { adminUserId: 1, recipientType: 'BRANCH_MANAGER' },
      { adminUserId: 2, recipientType: 'OWNER' },
      { adminUserId: 4, recipientType: 'EXECUTIVE' },
    ]);
    expect(autoIncidentRecipients({ branchId: null, admins, escalated: false })).toEqual([]);
  });
  it('필수 입력: 피해 유형·발생 경위·피해 내용, 길이 제한(4,000/2,000자)', () => {
    expect(checkIncidentInput({ damageType: '', circumstance: 'a', damageDetail: 'b' })).toBe(MSG.required('피해 유형'));
    expect(checkIncidentInput({ damageType: 'WATER_LEAK', circumstance: ' ', damageDetail: 'b' })).toBe(MSG.required('발생 경위'));
    expect(checkIncidentInput({ damageType: 'WATER_LEAK', circumstance: 'a', damageDetail: 'x'.repeat(2001) })).toBe('피해 내용은 2,000자 이내로 입력하세요.');
    expect(checkIncidentInput({ damageType: 'WATER_LEAK', circumstance: 'a', damageDetail: 'b' })).toBeNull();
  });
  it('진행 상태는 앞으로만, 종결은 어디서나', () => {
    expect(() => assertIncidentTransition('REPORTED', 'NEGOTIATING')).not.toThrow();
    expect(() => assertIncidentTransition('COMPENSATED', 'INVESTIGATING')).toThrow();
    expect(() => assertIncidentTransition('INVESTIGATING', 'CLOSED')).not.toThrow();
    expect(() => assertIncidentTransition('CLOSED', 'REPORTED')).toThrow();
  });
});

describe('독촉·전달 (F-ADM-CSL-11)', () => {
  it('같은 주문 기준 독촉 회차 자동 증가', () => {
    expect(nextFollowupCount([])).toBe(1);
    expect(nextFollowupCount([1, 2])).toBe(3);
    expect(nextFollowupCount([3, 1])).toBe(4);
  });
  it('출장 독촉은 대상 주문·전달 내용(80자 이내) 필수, 상담 독촉은 받을 관리자 필수', () => {
    expect(checkFollowupInput({ targetType: 'ORDER', targetOrderId: null, message: '빨리', receiverAdminId: null })).toBe(MSG.required('대상 주문'));
    expect(checkFollowupInput({ targetType: 'ORDER', targetOrderId: 1, message: ' ', receiverAdminId: null })).toBe(MSG.required('전달 내용'));
    expect(checkFollowupInput({ targetType: 'ORDER', targetOrderId: 1, message: 'x'.repeat(81), receiverAdminId: null })).toBe('전달 내용은 80자 이내로 입력하세요.');
    expect(checkFollowupInput({ targetType: 'CONSULT', targetOrderId: null, message: '연락 바랍니다', receiverAdminId: null })).toBe(MSG.required('받을 담당자'));
    expect(checkFollowupInput({ targetType: 'ORDER', targetOrderId: 1, message: '고객이 기다립니다', receiverAdminId: null })).toBeNull();
  });
  it('출장 독촉은 주기사에게, 기사가 없으면 담당 관리자에게', () => {
    expect(followupReceiverOf({ targetType: 'ORDER', mainTechId: 7, receiverAdminId: null })).toEqual({ techId: 7, adminId: null });
    expect(followupReceiverOf({ targetType: 'ORDER', mainTechId: null, receiverAdminId: 3 })).toEqual({ techId: null, adminId: 3 });
    expect(followupReceiverOf({ targetType: 'ORDER', mainTechId: null, receiverAdminId: null })).toBeNull();
    expect(followupReceiverOf({ targetType: 'CONSULT', mainTechId: 7, receiverAdminId: 3 })).toEqual({ techId: null, adminId: 3 });
  });
  it('상태: 발송 → 읽음 → 회신 → 종결, 발송에서 바로 회신 가능', () => {
    expect(() => assertFollowupTransition('SENT', 'REPLIED')).not.toThrow();
    expect(() => assertFollowupTransition('READ', 'REPLIED')).not.toThrow();
    expect(() => assertFollowupTransition('REPLIED', 'READ')).toThrow();
    expect(() => assertFollowupTransition('CLOSED', 'REPLIED')).toThrow();
  });
});

describe('번호 체계 (01 §2.6·§2.12)', () => {
  it('접두 + KST YYMMDD + 4자리', () => {
    expect(formatAfterNo('V', d('2026-11-21T16:00:00Z'), 1)).toBe('V2611220001');
    expect(formatAfterNo('S', d('2026-11-22T01:00:00+09:00'), 23)).toBe('S2611220023');
    expect(() => formatAfterNo('A', d('2026-11-22T01:00:00+09:00'), 10000)).toThrow();
  });
});
