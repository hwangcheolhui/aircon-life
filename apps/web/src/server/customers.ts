import 'server-only';
/**
 * 고객·주소·동의 서버 서비스 (F-CUS-AUTH-01~05, F-CUS-MY-01, 01 §2.2).
 * 🔒 컬럼(이름·연락처·상세주소)은 암호화해 저장하고, 전화번호 검색은 phone1_hash 로만 한다(ERD §6).
 */
import { consentHistory, customer, customerAddress, serviceOrder } from '@aircon/db';
import {
  type ConsentState,
  type ConsentType,
  CONSENT_ITEMS,
  SETTING_KEYS,
  addressKey,
  canWithdraw,
  consentChanges,
  currentConsents,
  formatCustomerNo,
  kstDate,
  kstYymmdd,
} from '@aircon/domain';
import { and, asc, desc, eq, inArray, isNull, like } from 'drizzle-orm';
import { UserError } from './action-result';
import { getDb } from './db';
import { decrypt, encrypt, phoneHash } from './pii';
import { getSettingNumber, getSettingString } from './settings';

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const LIVE_STATUSES = ['ACTIVE', 'DORMANT'];

/** F-CUS-AUTH-04 같은 휴대폰 번호의 기존 고객(전화 접수 고객 포함) */
export async function findCustomerByPhone(phone: string) {
  const [row] = await getDb()
    .select({ id: customer.id, authProvider: customer.authProvider, status: customer.status })
    .from(customer)
    .where(and(eq(customer.phone1Hash, phoneHash(phone)), inArray(customer.status, LIVE_STATUSES), isNull(customer.deletedAt)))
    .orderBy(asc(customer.id))
    .limit(1);
  return row ?? null;
}

export async function findCustomerBySocial(provider: string, key: string) {
  const [row] = await getDb()
    .select({ id: customer.id })
    .from(customer)
    .where(
      and(
        eq(customer.authProvider, provider),
        eq(customer.authProviderKey, key),
        inArray(customer.status, LIVE_STATUSES),
        isNull(customer.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** F-CUS-AUTH-04 기존 고객 레코드에 앱 로그인 수단 연결(이력 승계). 휴면이면 정상으로 되돌린다 */
export async function linkAppLogin(customerId: number, provider: string, key: string | null) {
  await getDb()
    .update(customer)
    .set({ authProvider: provider, authProviderKey: key, status: 'ACTIVE', updatedAt: new Date(), updatedBy: customerId })
    .where(eq(customer.id, customerId));
}

async function nextCustomerNo(tx: Tx, now: Date) {
  const prefix = `C${kstYymmdd(now).slice(0, 4)}`;
  const [last] = await tx
    .select({ no: customer.customerNo })
    .from(customer)
    .where(like(customer.customerNo, `${prefix}%`))
    .orderBy(desc(customer.customerNo))
    .limit(1);
  return formatCustomerNo(now, last ? Number(last.no.slice(prefix.length)) + 1 : 1);
}

/** 동의 이력 INSERT (consent_history INSERT ONLY) */
async function insertConsents(
  tx: Tx,
  customerId: number,
  rows: { consentType: ConsentType; action: 'AGREE' | 'DISAGREE' | 'WITHDRAW' }[],
  channel: 'APP' | 'PHONE' | 'WEB',
  termsVersion: string,
  agentAdminId: number | null = null,
) {
  if (rows.length === 0) return;
  await tx.insert(consentHistory).values(rows.map((r) => ({ customerId, ...r, channel, termsVersion, agentAdminId })));
}

/**
 * F-CUS-AUTH-01·02 가입: 고객 생성 + 동의 이력. 앱 가입은 필수 동의가 끝난 뒤에만 부른다.
 * 관리자 수동 등록(A-ORD-040)은 consents=null 로 부르고 개인정보 동의 상태는 질의못함(NOT_ASKED)으로 둔다(동의는 상담 콘솔 단계 3).
 */
export async function createCustomer(
  input: {
    name: string;
    phone: string;
    joinChannel: 'APP' | 'PHONE';
    authProvider: string | null;
    authProviderKey: string | null;
    consents: ConsentState | null;
    customerType?: 'PERSONAL' | 'BUSINESS';
    actorId?: number | null;
  },
  now = new Date(),
): Promise<number> {
  const termsVersion = await getSettingString(SETTING_KEYS.TERMS_VERSION);
  for (let attempt = 0; ; attempt++) {
    try {
      return await getDb().transaction(async (tx) => {
        const customerNo = await nextCustomerNo(tx, now);
        const [row] = await tx
          .insert(customer)
          .values({
            customerNo,
            customerType: input.customerType ?? 'PERSONAL',
            name: encrypt(input.name)!,
            phone1: encrypt(input.phone)!,
            phone1Hash: phoneHash(input.phone),
            joinChannel: input.joinChannel,
            authProvider: input.authProvider,
            authProviderKey: input.authProviderKey,
            privacyAgreeStatus: input.consents ? 'AGREED' : 'NOT_ASKED',
            marketingAgree: Boolean(input.consents?.MARKETING_SMS || input.consents?.MARKETING_PUSH),
            status: 'ACTIVE',
            createdBy: input.actorId ?? null,
            updatedBy: input.actorId ?? null,
          })
          .returning({ id: customer.id });
        if (input.consents) {
          await insertConsents(
            tx,
            row!.id,
            CONSENT_ITEMS.map((c) => ({ consentType: c.type, action: input.consents![c.type] ? 'AGREE' : 'DISAGREE' })),
            'APP',
            termsVersion,
          );
        }
        return row!.id;
      });
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code === '23505' && attempt < 4) continue;
      throw e;
    }
  }
}

/** C-MY-010 내 정보 (본인 화면이라 원문을 보여 준다) */
export async function getCustomerProfile(customerId: number) {
  const db = getDb();
  const [c] = await db.select().from(customer).where(eq(customer.id, customerId));
  if (!c) return null;
  const addresses = await db
    .select()
    .from(customerAddress)
    .where(and(eq(customerAddress.customerId, customerId), isNull(customerAddress.deletedAt)))
    .orderBy(desc(customerAddress.isDefault), desc(customerAddress.updatedAt));
  return {
    customerNo: c.customerNo,
    name: decrypt(c.name) ?? '',
    phone: decrypt(c.phone1) ?? '',
    email: c.email,
    authProvider: c.authProvider,
    marketingAgree: c.marketingAgree,
    addresses: addresses.map((a) => ({
      id: a.id,
      alias: a.alias,
      roadAddress: a.roadAddress,
      detailAddress: decrypt(a.detailAddress),
      isDefault: a.isDefault,
      housingType: a.housingType,
    })),
  };
}

/** 고객 이름·연락처 원문 (알림 발송·본인 화면용) */
export async function getCustomerContact(customerId: number) {
  const [c] = await getDb()
    .select({ name: customer.name, phone: customer.phone1, status: customer.status })
    .from(customer)
    .where(eq(customer.id, customerId));
  return c ? { name: decrypt(c.name) ?? '', phone: decrypt(c.phone) ?? '', status: c.status } : null;
}

/**
 * F-CUS-RSV-02 방문지 주소: 같은 주소(도로명+상세)가 있으면 그 주소를 쓰고 방문 정보만 갱신, 없으면 새로 저장.
 * 처음 저장하는 주소는 기본 주소가 된다.
 */
export async function upsertVisitAddress(
  tx: Tx,
  customerId: number,
  a: {
    zipcode: string;
    roadAddress: string;
    jibunAddress: string | null;
    legalDongCode: string;
    detailAddress: string;
    housingType: string;
    hasElevator: boolean;
    parkingNote: string | null;
    branchId: number;
  },
  actorId: number | null,
) {
  const existing = await tx
    .select()
    .from(customerAddress)
    .where(and(eq(customerAddress.customerId, customerId), isNull(customerAddress.deletedAt)));
  const key = addressKey(a.roadAddress, a.detailAddress);
  const same = existing.find((e) => addressKey(e.roadAddress, decrypt(e.detailAddress)) === key);
  const values = {
    zipcode: a.zipcode,
    jibunAddress: a.jibunAddress,
    legalDongCode: a.legalDongCode,
    housingType: a.housingType,
    hasElevator: a.hasElevator,
    parkingNote: a.parkingNote,
    branchId: a.branchId,
  };
  if (same) {
    await tx.update(customerAddress).set({ ...values, updatedAt: new Date(), updatedBy: actorId }).where(eq(customerAddress.id, same.id));
    return same.id;
  }
  const [row] = await tx
    .insert(customerAddress)
    .values({
      customerId,
      roadAddress: a.roadAddress,
      detailAddress: encrypt(a.detailAddress),
      ...values,
      isDefault: existing.length === 0,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: customerAddress.id });
  return row!.id;
}

/** C-MY-010 주소 삭제(소프트 삭제) */
export async function deleteAddress(customerId: number, addressId: number) {
  await getDb()
    .update(customerAddress)
    .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: customerId })
    .where(and(eq(customerAddress.id, addressId), eq(customerAddress.customerId, customerId)));
}

/* ---------- 동의 (F-CUS-AUTH-03) ---------- */

export async function getConsents(customerId: number): Promise<ConsentState> {
  const rows = await getDb()
    .select({ consentType: consentHistory.consentType, action: consentHistory.action, createdAt: consentHistory.createdAt })
    .from(consentHistory)
    .where(eq(consentHistory.customerId, customerId));
  return currentConsents(rows);
}

/** C-MY-030 선택 동의 변경 → 바뀐 항목만 이력 INSERT, 마케팅 동의 캐시 갱신(BR-101 즉시 반영) */
export async function updateConsents(customerId: number, after: ConsentState) {
  const before = await getConsents(customerId);
  const changes = consentChanges(before, after);
  if (changes.length === 0) return;
  const termsVersion = await getSettingString(SETTING_KEYS.TERMS_VERSION);
  const merged = { ...before, ...after };
  await getDb().transaction(async (tx) => {
    await insertConsents(tx, customerId, changes, 'APP', termsVersion);
    await tx
      .update(customer)
      .set({ marketingAgree: Boolean(merged.MARKETING_SMS || merged.MARKETING_PUSH), updatedAt: new Date(), updatedBy: customerId })
      .where(eq(customer.id, customerId));
  });
}

/* ---------- 탈퇴 (F-CUS-AUTH-05) ---------- */

/** 진행 중 주문이 없을 때 탈퇴. 필수 동의 철회 이력 + 보관기간 후 파기 예정일(ERD §6) */
export async function withdrawCustomer(customerId: number, reason: string | null, now = new Date()) {
  const db = getDb();
  const orders = await db.select({ status: serviceOrder.status }).from(serviceOrder).where(eq(serviceOrder.customerId, customerId));
  if (!canWithdraw(orders.map((o) => o.status))) throw new UserError('진행 중인 예약이 있어 탈퇴할 수 없습니다. 예약을 취소하거나 완료된 뒤 다시 시도해 주세요.');
  const years = await getSettingNumber(SETTING_KEYS.PURGE_YEARS);
  const termsVersion = await getSettingString(SETTING_KEYS.TERMS_VERSION);
  const today = kstDate(now);
  const purge = `${Number(today.slice(0, 4)) + years}${today.slice(4)}`;
  const consents = await getConsents(customerId);
  await db.transaction(async (tx) => {
    await insertConsents(
      tx,
      customerId,
      CONSENT_ITEMS.filter((c) => c.required || consents[c.type]).map((c) => ({ consentType: c.type, action: 'WITHDRAW' as const })),
      'APP',
      termsVersion,
    );
    const [c] = await tx.select({ memo: customer.memo }).from(customer).where(eq(customer.id, customerId));
    await tx
      .update(customer)
      .set({
        status: 'WITHDRAWN',
        withdrawnAt: now,
        purgeDueDate: purge,
        marketingAgree: false,
        authProviderKey: null,
        memo: reason ? [c?.memo, `[탈퇴 사유 ${today}] ${reason}`].filter(Boolean).join('\n') : (c?.memo ?? null),
        updatedAt: now,
        updatedBy: customerId,
      })
      .where(eq(customer.id, customerId));
  });
}
