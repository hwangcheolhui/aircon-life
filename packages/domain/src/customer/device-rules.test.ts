import { describe, expect, it } from 'vitest';
import { checkDeviceInput, isCleanDue, matchUnitsToDevices, nextCleanDate, rebookLines, recognizedDeviceCounts } from './device-rules';

const types = ['WALL', 'STAND'];
const brands = ['SAMSUNG', 'LG'];

describe('내 기기 입력 (F-CUS-DEV-01)', () => {
  it('정상 입력이면 오류 없음', () => {
    expect(checkDeviceInput({ deviceType: 'WALL', deviceTypes: types, brand: 'LG', brands, installYear: 2020, thisYear: 2026, addressId: 1 })).toEqual({});
  });
  it('형태·주소 필수, 목록 밖 제조사·범위 밖 설치 연도는 오류', () => {
    const e = checkDeviceInput({ deviceType: 'X', deviceTypes: types, brand: 'NOPE', brands, installYear: 2030, thisYear: 2026, addressId: null });
    expect(Object.keys(e).sort()).toEqual(['addressId', 'brand', 'deviceType', 'installYear']);
  });
});

describe('다음 권장 청소일', () => {
  it('작업 결과 권장 개월이 있으면 그 값, 없으면 기본 개월', () => {
    expect(nextCleanDate('2026-06-15', 6, 12)).toBe('2026-12-15');
    expect(nextCleanDate('2026-06-15', null, 12)).toBe('2027-06-15');
    expect(nextCleanDate(null, 6, 12)).toBeNull();
  });
  it('권장일이 오늘이거나 지났으면 청소할 때', () => {
    expect(isCleanDue('2026-11-26', '2026-11-26')).toBe(true);
    expect(isCleanDue('2026-12-01', '2026-11-26')).toBe(false);
    expect(isCleanDue(null, '2026-11-26')).toBe(false);
  });
});

describe('원클릭 재예약 견적 줄 (F-CUS-DEV-02)', () => {
  const quotable = [
    { deviceType: 'WALL', cleanLevel: 'BASIC' },
    { deviceType: 'WALL', cleanLevel: 'FULL' },
    { deviceType: 'STAND', cleanLevel: 'BASIC' },
  ];
  it('같은 형태·같은 범위는 대수로 묶고 이전 범위를 유지한다', () => {
    const r = rebookLines(
      [
        { deviceType: 'WALL', lastCleanLevel: 'FULL' },
        { deviceType: 'WALL', lastCleanLevel: 'FULL' },
        { deviceType: 'STAND', lastCleanLevel: null },
      ],
      quotable,
    );
    expect(r.lines).toEqual([
      { deviceType: 'WALL', cleanLevel: 'FULL', quantity: 2 },
      { deviceType: 'STAND', cleanLevel: 'BASIC', quantity: 1 },
    ]);
    expect(r.skipped).toEqual([]);
  });
  it('이전 범위 상품이 없어지면 그 형태의 다른 범위로, 형태 자체가 없으면 제외', () => {
    const r = rebookLines(
      [
        { deviceType: 'STAND', lastCleanLevel: 'FULL' },
        { deviceType: 'SYSTEM', lastCleanLevel: 'BASIC' },
      ],
      quotable,
    );
    expect(r.lines).toEqual([{ deviceType: 'STAND', cleanLevel: 'BASIC', quantity: 1 }]);
    expect(r.skipped).toEqual(['SYSTEM']);
  });
});

describe('작업 완료 때 보유 기기 연결', () => {
  it('연결된 기기는 그대로, 같은 형태의 남은 기존 기기, 없으면 새로 등록(null)', () => {
    const m = matchUnitsToDevices(
      [
        { key: 'a', deviceType: 'WALL', linkedDeviceId: 10 },
        { key: 'b', deviceType: 'WALL', linkedDeviceId: null },
        { key: 'c', deviceType: 'WALL', linkedDeviceId: null },
        { key: 'd', deviceType: 'STAND', linkedDeviceId: null },
      ],
      [
        { id: 10, deviceType: 'WALL' },
        { id: 11, deviceType: 'WALL' },
        { id: 12, deviceType: 'STAND' },
      ],
    );
    expect([...m.entries()]).toEqual([
      ['a', 10],
      ['b', 11],
      ['c', null],
      ['d', 12],
    ]);
  });
});

describe('사진 인식 → 견적 대수 (F-CUS-QUO-05)', () => {
  it('인식(고객 수정 반영)한 형태별로 센다', () => {
    expect(recognizedDeviceCounts([{ deviceType: 'WALL' }, { deviceType: 'WALL' }, { deviceType: null }, { deviceType: 'STAND' }])).toEqual({ WALL: 2, STAND: 1 });
  });
});
