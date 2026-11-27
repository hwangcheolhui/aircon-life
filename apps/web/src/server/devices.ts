import 'server-only';
/**
 * 내 기기·원클릭 재예약 (단계 9, F-CUS-DEV-01·02, C-DEV-010·020) + 작업 완료 때 기기 자동 연결.
 * - 고객 본인 기기만 다룬다(고객 세션 ID 조건). 삭제는 소프트 삭제(deleted_at)
 * - 다음 권장일 = 최근 청소일 + 권장 개월(작업 결과 recommend_next, 없으면 DEVICE_RECOMMEND_MONTHS)
 * - 재예약 = 공용 견적 모듈(issueQuote, BR-010~015)로 견적 발행 → 고객·주소·기기 연결 → /reserve/{견적번호}
 */
import { customerAddress, customerDevice, orderItem, quote, quoteItem, serviceOrder, serviceProduct, workResult } from '@aircon/db';
import { SETTING_KEYS, checkDeviceInput, kstDate, matchUnitsToDevices, nextCleanDate, isCleanDue, rebookLines } from '@aircon/domain';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { UserError, ValidationFailed } from './action-result';
import { loadCodes } from './codes';
import { getDb } from './db';
import type { Tx } from './orders';
import { issueQuote, loadQuoteChoices } from './quote';
import { getSettingNumber } from './settings';

export interface DeviceForm {
  id: number | null;
  addressId: number;
  deviceType: string;
  brand: string | null;
  modelName: string | null;
  installYear: number | null;
  locationInHouse: string | null;
  isInverter: boolean;
  hasHeating: boolean;
}

/** C-DEV-010 주소별 기기 목록 + 다음 권장일 */
export async function listMyDevices(customerId: number, now = new Date()) {
  const db = getDb();
  const [rows, addresses, defaultMonths] = await Promise.all([
    db
      .select()
      .from(customerDevice)
      .where(and(eq(customerDevice.customerId, customerId), isNull(customerDevice.deletedAt)))
      .orderBy(asc(customerDevice.addressId), asc(customerDevice.id)),
    db
      .select({ id: customerAddress.id, roadAddress: customerAddress.roadAddress, alias: customerAddress.alias })
      .from(customerAddress)
      .where(and(eq(customerAddress.customerId, customerId), isNull(customerAddress.deletedAt))),
    getSettingNumber(SETTING_KEYS.DEVICE_RECOMMEND_MONTHS),
  ]);
  const today = kstDate(now);
  const devices = rows.map((d) => {
    const next = nextCleanDate(d.lastCleanedAt, d.recommendMonths, defaultMonths);
    return {
      id: d.id,
      addressId: d.addressId,
      deviceType: d.deviceType,
      brand: d.brand,
      modelName: d.modelName,
      installYear: d.installYear,
      locationInHouse: d.locationInHouse,
      isInverter: d.isInverter ?? false,
      hasHeating: d.hasHeating ?? false,
      lastCleanedAt: d.lastCleanedAt,
      lastCleanLevel: d.lastCleanLevel,
      nextCleanDate: next,
      due: isCleanDue(next, today),
    };
  });
  return { devices, addresses };
}

export async function getMyDevice(customerId: number, id: number) {
  const { devices, addresses } = await listMyDevices(customerId);
  return { device: devices.find((d) => d.id === id) ?? null, addresses };
}

/** C-DEV-020 등록·수정 (F-CUS-DEV-01) */
export async function saveMyDevice(customerId: number, v: DeviceForm, now = new Date()) {
  const db = getDb();
  const codes = await loadCodes(['DEVICE_TYPE', 'BRAND']);
  const [addr] = await db
    .select({ id: customerAddress.id })
    .from(customerAddress)
    .where(and(eq(customerAddress.id, v.addressId), eq(customerAddress.customerId, customerId), isNull(customerAddress.deletedAt)));
  const e = checkDeviceInput({
    deviceType: v.deviceType,
    deviceTypes: (codes.DEVICE_TYPE ?? []).map((c) => c.value),
    brand: v.brand,
    brands: (codes.BRAND ?? []).map((c) => c.value),
    installYear: v.installYear,
    thisYear: Number(kstDate(now).slice(0, 4)),
    addressId: addr?.id ?? null,
  });
  if (Object.keys(e).length) throw new ValidationFailed(e);
  const values = {
    addressId: v.addressId,
    deviceType: v.deviceType,
    brand: v.brand,
    modelName: v.modelName,
    installYear: v.installYear,
    locationInHouse: v.locationInHouse,
    isInverter: v.isInverter,
    hasHeating: v.hasHeating,
    updatedAt: now,
    updatedBy: customerId,
  };
  if (v.id) {
    const rows = await db
      .update(customerDevice)
      .set(values)
      .where(and(eq(customerDevice.id, v.id), eq(customerDevice.customerId, customerId), isNull(customerDevice.deletedAt)))
      .returning({ id: customerDevice.id });
    if (!rows.length) throw new UserError('기기를 찾을 수 없습니다.');
    return v.id;
  }
  const [row] = await db
    .insert(customerDevice)
    .values({ ...values, customerId, createdBy: customerId })
    .returning({ id: customerDevice.id });
  return row!.id;
}

export async function deleteMyDevice(customerId: number, id: number, now = new Date()) {
  const rows = await getDb()
    .update(customerDevice)
    .set({ deletedAt: now, updatedAt: now, updatedBy: customerId })
    .where(and(eq(customerDevice.id, id), eq(customerDevice.customerId, customerId), isNull(customerDevice.deletedAt)))
    .returning({ id: customerDevice.id });
  if (!rows.length) throw new UserError('기기를 찾을 수 없습니다.');
}

/**
 * F-CUS-DEV-02 원클릭 재예약: 고른 기기(같은 주소)를 이전 작업 범위로 묶어 견적 발행.
 * 기기마다 견적 상품 줄에 customer_device_id 를 남긴다(같은 줄에 여러 대면 첫 기기, 나머지는 작업 완료 때 연결).
 */
export async function rebookDevices(customerId: number, deviceIds: number[], now = new Date()) {
  const db = getDb();
  const devices = await db
    .select()
    .from(customerDevice)
    .where(and(eq(customerDevice.customerId, customerId), inArray(customerDevice.id, deviceIds), isNull(customerDevice.deletedAt)));
  if (!devices.length) throw new UserError('다시 예약할 기기를 골라 주세요.');
  const addressIds = new Set(devices.map((d) => d.addressId));
  if (addressIds.size > 1) throw new UserError('한 주소의 기기만 함께 예약할 수 있어요.');
  const addressId = devices[0]!.addressId;
  if (!addressId) throw new UserError('기기의 설치 주소를 먼저 정해 주세요.');
  const [addr] = await db.select().from(customerAddress).where(and(eq(customerAddress.id, addressId), eq(customerAddress.customerId, customerId)));
  if (!addr?.legalDongCode) throw new UserError('설치 주소를 다시 확인해 주세요.');
  const choices = await loadQuoteChoices(addr.legalDongCode, {}, now);
  const { lines, skipped } = rebookLines(devices, choices.products);
  if (!lines.length) throw new UserError('지금 이 주소에서 예약할 수 있는 기기가 없어요. 견적 받기에서 다시 골라 주세요.');
  const r = await issueQuote({ legalDongCode: addr.legalDongCode, lines, options: [], customerType: 'PERSONAL', visit: null }, 'APP', now);
  if (!r.ok) {
    console.warn('재예약 견적 실패', r);
    throw new UserError(
      r.reason === 'NOT_SERVICEABLE'
        ? '이 주소는 지금 서비스하지 않는 지역이에요. 고객센터로 문의해 주세요.'
        : '지금 이 기기는 바로 견적을 낼 수 없어요. 견적 받기에서 다시 골라 주세요.',
    );
  }
  const [q] = await db
    .update(quote)
    .set({ customerId, addressId, updatedAt: now, updatedBy: customerId })
    .where(eq(quote.quoteNo, r.quoteNo))
    .returning({ id: quote.id });
  const items = await db
    .select({ id: quoteItem.id, deviceType: serviceProduct.deviceType, cleanLevel: serviceProduct.cleanLevel })
    .from(quoteItem)
    .innerJoin(serviceProduct, eq(serviceProduct.id, quoteItem.productId))
    .where(and(eq(quoteItem.quoteId, q!.id), eq(quoteItem.itemType, 'PRODUCT')));
  for (const it of items) {
    const d = devices.find((x) => x.deviceType === it.deviceType);
    if (d) await db.update(quoteItem).set({ customerDeviceId: d.id }).where(eq(quoteItem.id, it.id));
  }
  return { quoteNo: r.quoteNo, skipped };
}

/** 예약 생성 때 견적 줄의 기기 연결을 주문 항목에 옮긴다(같은 상품 줄) */
export async function copyQuoteDevices(tx: Tx, quoteId: number, orderId: number) {
  const linked = await tx
    .select({ productId: quoteItem.productId, deviceId: quoteItem.customerDeviceId })
    .from(quoteItem)
    .where(and(eq(quoteItem.quoteId, quoteId), eq(quoteItem.itemType, 'PRODUCT')));
  for (const l of linked) {
    if (!l.deviceId || !l.productId) continue;
    await tx
      .update(orderItem)
      .set({ customerDeviceId: l.deviceId })
      .where(and(eq(orderItem.orderId, orderId), eq(orderItem.productId, l.productId), eq(orderItem.itemType, 'PRODUCT')));
  }
}

/**
 * 작업 완료 후 기기 자동 연결 (F-CUS-DEV-01): 작업한 기기(작업 불가 제외)를 고객 보유 기기에 연결하고
 * 최근 청소일·작업 범위·권장 개월을 갱신한다. 실패해도 작업 완료는 그대로 둔다(로그만).
 */
export async function linkDevicesAfterWork(orderId: number, workOrderId: number, now = new Date()) {
  const db = getDb();
  try {
    const [o] = await db.select({ customerId: serviceOrder.customerId, addressId: serviceOrder.addressId }).from(serviceOrder).where(eq(serviceOrder.id, orderId));
    if (!o) return;
    const results = await db
      .select({
        id: workResult.id,
        orderItemId: workResult.orderItemId,
        unitNo: workResult.unitNo,
        result: workResult.result,
        recommendNext: workResult.recommendNext,
        linked: workResult.customerDeviceId,
        itemDevice: orderItem.customerDeviceId,
        deviceType: serviceProduct.deviceType,
        cleanLevel: serviceProduct.cleanLevel,
      })
      .from(workResult)
      .innerJoin(orderItem, eq(orderItem.id, workResult.orderItemId))
      .innerJoin(serviceProduct, eq(serviceProduct.id, orderItem.productId))
      .where(eq(workResult.workOrderId, workOrderId));
    const done = results.filter((r) => r.result !== 'SKIPPED');
    if (!done.length) return;
    const owned = await db
      .select({ id: customerDevice.id, deviceType: customerDevice.deviceType })
      .from(customerDevice)
      .where(
        and(
          eq(customerDevice.customerId, o.customerId),
          o.addressId ? eq(customerDevice.addressId, o.addressId) : isNull(customerDevice.addressId),
          isNull(customerDevice.deletedAt),
        ),
      )
      .orderBy(asc(customerDevice.id));
    const ownedIds = new Set(owned.map((d) => d.id));
    const keyOf = (r: { orderItemId: number; unitNo: number }) => `${r.orderItemId}:${r.unitNo}`;
    const map = matchUnitsToDevices(
      done.map((r) => {
        const pre = r.linked ?? (r.unitNo === 1 ? r.itemDevice : null);
        return { key: keyOf(r), deviceType: r.deviceType, linkedDeviceId: pre && ownedIds.has(pre) ? pre : null };
      }),
      owned,
    );
    const today = kstDate(now);
    await db.transaction(async (tx) => {
      for (const r of done) {
        let id = map.get(keyOf(r)) ?? null;
        const set = { lastCleanedAt: today, lastCleanLevel: r.cleanLevel, recommendMonths: r.recommendNext, updatedAt: now };
        if (id) await tx.update(customerDevice).set(set).where(eq(customerDevice.id, id));
        else {
          const [row] = await tx
            .insert(customerDevice)
            .values({ customerId: o.customerId, addressId: o.addressId, deviceType: r.deviceType, ...set })
            .returning({ id: customerDevice.id });
          id = row!.id;
        }
        await tx.update(workResult).set({ customerDeviceId: id }).where(eq(workResult.id, r.id));
      }
    });
  } catch (e) {
    console.error('기기 자동 연결 실패', orderId, e);
  }
}
