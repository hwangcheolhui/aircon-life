import { describe, expect, it } from 'vitest';
import {
  canSeeWorkReport,
  checkCompletion,
  checkDeparture,
  checkSafety,
  finalAmount,
  itemStatusFromResults,
  resultCodeFromResults,
  workMinutes,
  workUnits,
} from './work-rules';

describe('BR-043 작업 시작 전 안전 체크리스트', () => {
  const all = ['HIGH_PLACE', 'ELECTRIC', 'PROTECTIVE', 'CHEMICAL'];

  it('BR-043 네 항목을 모두 확인하면 작업을 시작할 수 있다', () => {
    expect(checkSafety({ checked: all, highPlaceWork: false, teamSize: 1 })).toEqual({
      ok: true,
      missing: [],
      soloHighPlaceWarning: false,
    });
  });

  it('BR-043 예외: 한 항목이라도 빠지면 시작할 수 없다', () => {
    const r = checkSafety({ checked: ['ELECTRIC', 'PROTECTIVE'], highPlaceWork: false, teamSize: 1 });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['HIGH_PLACE', 'CHEMICAL']);
  });

  it('BR-043 모르는 항목·중복은 무시한다', () => {
    const r = checkSafety({ checked: ['ELECTRIC', 'ELECTRIC', 'FOO'], highPlaceWork: false, teamSize: 2 });
    expect(r.missing).toEqual(['HIGH_PLACE', 'PROTECTIVE', 'CHEMICAL']);
  });

  it('BR-043 고소작업을 혼자 하면 2인 이상 권장 경고(막지는 않음)', () => {
    const solo = checkSafety({ checked: all, highPlaceWork: true, teamSize: 1 });
    expect(solo.ok).toBe(true);
    expect(solo.soloHighPlaceWarning).toBe(true);
    expect(checkSafety({ checked: all, highPlaceWork: true, teamSize: 2 }).soloHighPlaceWarning).toBe(false);
  });
});

describe('F-TEC-WRK-01 출발 가능 여부 (확정 코스의 다음 방문지 기준)', () => {
  const base = {
    orderNo: 'A1',
    orderStatus: 'ASSIGNED',
    role: 'MAIN',
    promisedDate: '2026-12-01',
    today: '2026-12-01',
    otherActiveOrderNo: null,
    nextStopOrderNo: 'A1',
  };

  it('오늘 약속·배정완료·주기사면 출발할 수 있다', () => {
    expect(checkDeparture(base)).toEqual({ ok: true, warning: null });
  });

  it('코스의 다음 방문지가 아니면 경고만 한다', () => {
    const r = checkDeparture({ ...base, nextStopOrderNo: 'B2' });
    expect(r).toMatchObject({ ok: true, warning: expect.stringContaining('B2') });
  });

  it('예외: 오늘 약속이 아니면 출발할 수 없다', () => {
    expect(checkDeparture({ ...base, promisedDate: '2026-12-02' }).ok).toBe(false);
    expect(checkDeparture({ ...base, promisedDate: null }).ok).toBe(false);
  });

  it('예외: 지원기사·동행은 출발 처리하지 않는다(주기사만)', () => {
    expect(checkDeparture({ ...base, role: 'SUPPORT' }).ok).toBe(false);
  });

  it('예외: 이미 진행 중인 다른 작업이 있으면 출발할 수 없다', () => {
    const r = checkDeparture({ ...base, otherActiveOrderNo: 'C3' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('C3');
  });

  it('예외: 배정완료가 아니면 출발할 수 없다', () => {
    expect(checkDeparture({ ...base, orderStatus: 'RECEIVED' }).ok).toBe(false);
    expect(checkDeparture({ ...base, orderStatus: 'ON_THE_WAY' }).ok).toBe(false);
  });
});

const items = [
  { id: 11, itemType: 'PRODUCT', quantity: 2, name: '벽걸이' },
  { id: 12, itemType: 'OPTION', quantity: 1, name: '실외기' },
  { id: 13, itemType: 'PRODUCT', quantity: 1, name: '스탠드' },
  { id: 14, itemType: 'SURCHARGE', quantity: 1, name: '야간' },
];

describe('기기 단위 (주문 항목 수량만큼)', () => {
  it('상품 항목만, 수량만큼 1번부터 나눈다', () => {
    expect(workUnits(items)).toEqual([
      { orderItemId: 11, unitNo: 1, label: '벽걸이 1' },
      { orderItemId: 11, unitNo: 2, label: '벽걸이 2' },
      { orderItemId: 13, unitNo: 1, label: '스탠드' },
    ]);
  });
});

describe('BR-041 / F-TEC-WRK-07 처리 저장(완료) 필수 검증', () => {
  const units = workUnits(items);
  const done = units.map((u) => ({ ...u, result: 'DONE' }));
  const photos = units.flatMap((u) => [
    { orderItemId: u.orderItemId, unitNo: u.unitNo, photoType: 'BEFORE' },
    { orderItemId: u.orderItemId, unitNo: u.unitNo, photoType: 'AFTER' },
  ]);
  const ok = {
    workStatus: 'IN_PROGRESS',
    units,
    results: done,
    photos,
    safetyDone: true,
    pendingExtraCharges: 0,
    workNote: '벽걸이 2대·스탠드 1대 완전분해 세척 완료',
    noteMinLength: 10,
  };

  it('BR-041 모든 기기 결과·전후 사진·안전 체크·처리 내용이 있으면 완료할 수 있다', () => {
    expect(checkCompletion(ok)).toEqual({ ok: true, problems: [] });
  });

  it('BR-041 예외: 작업한 기기 하나라도 작업 후 사진이 없으면 완료가 막힌다', () => {
    const r = checkCompletion({
      ...ok,
      photos: photos.filter((p) => !(p.orderItemId === 11 && p.unitNo === 2 && p.photoType === 'AFTER')),
    });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([{ code: 'PHOTO_MISSING', message: '벽걸이 2 작업 후 사진이 없습니다.' }]);
  });

  it('BR-041 일부 작업(PARTIAL)도 작업한 기기라 전후 사진이 필요하다', () => {
    const r = checkCompletion({
      ...ok,
      results: done.map((d) => (d.orderItemId === 13 ? { ...d, result: 'PARTIAL' } : d)),
      photos: photos.filter((p) => p.orderItemId !== 13),
    });
    expect(r.problems.map((p) => p.code)).toEqual(['PHOTO_MISSING', 'PHOTO_MISSING']);
  });

  it('BR-041 작업 불가(SKIPPED) 기기는 사진이 없어도 된다', () => {
    const r = checkCompletion({
      ...ok,
      results: done.map((d) => (d.orderItemId === 13 ? { ...d, result: 'SKIPPED' } : d)),
      photos: photos.filter((p) => p.orderItemId !== 13),
    });
    expect(r.ok).toBe(true);
  });

  it('예외: 결과를 입력하지 않은 기기가 있으면 완료가 막힌다', () => {
    const r = checkCompletion({ ...ok, results: done.slice(1) });
    expect(r.problems).toEqual([{ code: 'RESULT_MISSING', message: '벽걸이 1 처리 결과를 입력해 주세요.' }]);
  });

  it('BR-043 예외: 안전 체크리스트를 마치지 않으면 완료가 막힌다', () => {
    expect(checkCompletion({ ...ok, safetyDone: false }).problems.map((p) => p.code)).toEqual(['SAFETY']);
  });

  it('예외: 처리 내용이 기준 글자 수보다 짧으면 완료가 막힌다(공백 제외)', () => {
    expect(checkCompletion({ ...ok, workNote: '세척 완료     ' }).problems.map((p) => p.code)).toEqual(['NOTE_SHORT']);
  });

  it('예외: 동의·철회되지 않은 추가요금이 있으면 완료가 막힌다', () => {
    expect(checkCompletion({ ...ok, pendingExtraCharges: 1 }).problems.map((p) => p.code)).toEqual(['EXTRA_PENDING']);
  });

  it('예외: 모든 기기가 작업 불가면 완료 대신 미처리로 저장해야 한다', () => {
    const r = checkCompletion({ ...ok, results: done.map((d) => ({ ...d, result: 'SKIPPED' })), photos: [] });
    expect(r.problems.map((p) => p.code)).toEqual(['NOTHING_DONE']);
  });

  it('예외: 작업중이 아니면 완료할 수 없다', () => {
    expect(checkCompletion({ ...ok, workStatus: 'ARRIVED' }).problems.map((p) => p.code)).toEqual(['NOT_IN_PROGRESS']);
  });
});

describe('완료 금액·소요시간·결과 코드', () => {
  it('최종 금액 = 작업비 + 동의된 추가요금 + 자재 − 할인 (0원 미만 없음)', () => {
    expect(finalAmount({ laborAmount: 90000, agreedExtra: 20000, materialAmount: 5000, discountAmount: 10000 })).toBe(105000);
    expect(finalAmount({ laborAmount: 1000, agreedExtra: 0, materialAmount: 0, discountAmount: 5000 })).toBe(0);
  });

  it('작업 소요(분) = 시작~종료 반올림', () => {
    expect(workMinutes(new Date('2026-12-01T01:00:00Z'), new Date('2026-12-01T02:29:40Z'))).toBe(90);
    expect(workMinutes(null, new Date())).toBeNull();
  });

  it('주문 항목 상태: 한 대라도 작업했으면 완료, 모두 불가면 작업불가', () => {
    expect(itemStatusFromResults(['DONE', 'SKIPPED'])).toBe('DONE');
    expect(itemStatusFromResults(['PARTIAL'])).toBe('DONE');
    expect(itemStatusFromResults(['SKIPPED', 'SKIPPED'])).toBe('SKIPPED');
  });

  it('처리 코드: 모두 완료=정상완료, 일부=일부완료, 수리 안내=수리필요안내, 작업 없음=세척불가', () => {
    expect(resultCodeFromResults(['DONE', 'DONE'], false)).toBe('DONE_NORMAL');
    expect(resultCodeFromResults(['DONE', 'SKIPPED'], false)).toBe('DONE_PARTIAL');
    expect(resultCodeFromResults(['PARTIAL'], false)).toBe('DONE_PARTIAL');
    expect(resultCodeFromResults(['DONE'], true)).toBe('NEED_REPAIR');
    expect(resultCodeFromResults(['SKIPPED'], true)).toBe('NOT_CLEANABLE');
  });
});

describe('F-CUS-ORD-05 작업 리포트 공개', () => {
  it('작업완료·완료 주문만 고객이 리포트를 본다', () => {
    expect(canSeeWorkReport('WORK_DONE')).toBe(true);
    expect(canSeeWorkReport('COMPLETED')).toBe(true);
    expect(canSeeWorkReport('IN_PROGRESS')).toBe(false);
    expect(canSeeWorkReport('PENDING')).toBe(false);
  });
});
