'use server';
/**
 * A-CSL-010 상담 콘솔 서버 액션 (F-ADM-CSL-01~10·13~16).
 * 모든 액션 첫 줄에서 화면 권한을 서버가 확인하고(requirePermission), 거점 범위(BR-102)는 서비스(server/consult)에서 일괄 적용한다.
 */
import {
  consentAnswerInput,
  consoleCustomerInput,
  consoleCustomerUpdateInput,
  consultRecordInput,
  followupInput,
  incidentInput,
  legalDongCodeInput,
  phoneInput,
  phoneOrderInput,
  quoteLineInput,
  quoteOptionInput,
  z,
} from '@aircon/contracts';
import { hasPermission, slotsNeeded } from '@aircon/domain';
import { revalidatePath } from 'next/cache';
import { UserError, handle, parse } from '@/server/action-result';
import { writeAudit } from '@/server/audit';
import { type CurrentAdmin, requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import {
  branchStatus,
  createPhoneOrder,
  getConsoleCustomer,
  listAvailableTechs,
  listOnCallTechs,
  loadTimeTable,
  previewPhoneOrder,
  recordConsult,
  recordPrivacyConsent,
  refineAddress,
  registerConsoleCustomer,
  revealConsoleCustomer,
  searchConsoleCustomers,
  startCall,
  updateConsoleCustomer,
} from '@/server/consult';
import { createFollowup, followupTargets } from '@/server/followups';
import { createIncident } from '@/server/incidents';

const MENU = 'A-CSL-010';
const actorOf = (a: CurrentAdmin) => ({ type: 'ADMIN' as const, id: a.adminId });
const id = (label: string) => z.coerce.number({ invalid_type_error: `${label}이(가) 올바르지 않습니다.` }).int().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다.');
const hour = z.coerce.number().int().min(0).max(23);

/** BR-102 거점 범위 안의 거점인지 */
async function assertBranch(admin: CurrentAdmin, branchId: number) {
  const f = await currentBranchFilter(admin);
  if (f.kind === 'NONE' || (f.kind === 'BRANCH' && f.branchId !== branchId)) throw new UserError('다른 거점 현황은 볼 수 없습니다.');
}

/** F-ADM-CSL-01 전화1 → 일치 고객 목록 (A-CSL-011) */
export async function searchCustomers(phone: string) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    return searchConsoleCustomers(parse(phoneInput('전화1'), phone), await currentBranchFilter(admin));
  });
}

/** 고객 확정(더블클릭·등록 직후) → 통화 기록 1행(CTI 전 수기) + 콘솔 데이터 */
export async function confirmCustomer(customerId: number, phone: string) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    const cid = parse(id('고객'), customerId);
    const filter = await currentBranchFilter(admin);
    const data = await getConsoleCustomer(cid, filter);
    // 임시 개발 모드(읽기 전용)에서는 통화 기록을 남기지 않는다
    const canWrite = !admin.preview && hasPermission(admin, MENU, 'CREATE');
    const p = phoneInput().safeParse(phone);
    const callLogId = canWrite && p.success ? await startCall(cid, p.data, actorOf(admin)) : null;
    return { ...data, callLogId };
  });
}

/** 저장 후 콘솔 다시 읽기 (통화 기록은 새로 만들지 않음) */
export async function reloadCustomer(customerId: number) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    return getConsoleCustomer(parse(id('고객'), customerId), await currentBranchFilter(admin));
  });
}

/** [보기] 원문 열람 → 감사 로그(VIEW_PII, BR-100) */
export async function viewCustomerPii(customerId: number) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const cid = parse(id('고객'), customerId);
    const pii = await revealConsoleCustomer(cid, await currentBranchFilter(admin));
    await writeAudit({ actorId: admin.adminId, action: 'VIEW_PII', targetTable: 'customer', targetId: cid, detail: { screen: MENU, fields: ['name', 'phone1', 'phone2'] } });
    return pii;
  });
}

/** A-CSL-012 ④ 주소정제: 관할 확인 */
export async function refineAddressAction(legalDongCode: string) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    return refineAddress(parse(legalDongCodeInput, legalDongCode), await currentBranchFilter(admin));
  });
}

/** F-ADM-CSL-02 신규 고객 등록 */
export async function registerCustomer(values: unknown) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'CREATE');
    const v = parse(consoleCustomerInput, values);
    const customerId = await registerConsoleCustomer(v, await currentBranchFilter(admin), actorOf(admin));
    return { customerId };
  });
}

/** F-ADM-CSL-15 고객정보 수정 (A-CSL-014) */
export async function updateCustomer(values: unknown) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const v = parse(consoleCustomerUpdateInput, values);
    await updateConsoleCustomer(v, await currentBranchFilter(admin), actorOf(admin));
  });
}

/** F-ADM-CSL-03 개인정보 동의·미동의·질의못함·철회 (A-CSL-013, BR-023) */
export async function answerConsent(values: unknown) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const v = parse(consentAnswerInput, values);
    return recordPrivacyConsent(v, await currentBranchFilter(admin), actorOf(admin));
  });
}

/** ③ 거점·지역 현황 */
export async function loadBranchStatus(branchId: number) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    const b = parse(id('거점'), branchId);
    await assertBranch(admin, b);
    return branchStatus(b);
  });
}

/** F-ADM-CSL-06 Time Table 7일 (A-CSL-021) */
export async function loadTimeTableAction(branchId: number, start: string) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    const b = parse(id('거점'), branchId);
    await assertBranch(admin, b);
    return loadTimeTable(b, parse(date, start));
  });
}

/** F-ADM-CSL-07 출장 가능 기사 (A-CSL-022) */
export async function loadAvailableTechs(branchId: number, slotDate: string, slotHour: number, durationMin: number) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    const b = parse(id('거점'), branchId);
    await assertBranch(admin, b);
    return listAvailableTechs(b, parse(date, slotDate), parse(hour, slotHour), slotsNeeded(Math.max(Number(durationMin) || 60, 1)));
  });
}

/** F-ADM-CSL-08 휴일 근무 기사 (A-CSL-023) */
export async function loadOnCallTechs(branchId: number, slotDate: string) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    const b = parse(id('거점'), branchId);
    await assertBranch(admin, b);
    return listOnCallTechs(b, parse(date, slotDate));
  });
}

const previewInput = z.object({
  customerId: id('고객'),
  addressId: id('방문 주소'),
  lines: z.array(quoteLineInput).min(1, '기기 형태는 필수 입력값입니다.').max(20),
  options: z.array(quoteOptionInput).max(20).default([]),
  slotDate: date.nullable().default(null),
  slotHour: hour.nullable().default(null),
});

/** 자동 견적(F-CUS-QUO-04 공용 로직) + 야간·휴일 할증 안내(F-ADM-CSL-09) */
export async function previewOrder(values: unknown) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    return previewPhoneOrder(parse(previewInput, values), await currentBranchFilter(admin));
  });
}

/** F-ADM-CSL-05 출장접수 저장 (+ F-ADM-CSL-10 이중접수 리스트) */
export async function submitOrder(values: unknown) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'CREATE');
    const v = parse(phoneOrderInput, values);
    const r = await createPhoneOrder(v, await currentBranchFilter(admin), actorOf(admin));
    if (r.ok) revalidatePath('/admin/ord/orders');
    return r;
  });
}

/** F-ADM-CSL-13 일반문의·클레임 기록 (A-CSL-050) */
export async function submitConsult(values: unknown) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'CREATE');
    const v = parse(consultRecordInput, values);
    const r = await recordConsult(v, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath('/admin/csl/history');
    return r;
  });
}

/* ---------- 단계 8: A-CSL-030 독촉/전달 탭 (F-ADM-CSL-11) · A-CSL-040 안전사고 탭 (F-ADM-CSL-12) ---------- */

/** A-CSL-030 대상 주문(진행 중)·회차·관리자 수신자 목록 */
export async function loadFollowupTargets(customerId: number) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'READ');
    return followupTargets(parse(id('고객'), customerId), await currentBranchFilter(admin));
  });
}

/** F-ADM-CSL-11 독촉/전달 저장 → 기사 앱(또는 관리자) 알림 */
export async function submitFollowup(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'CREATE');
    const v = parse(followupInput, values);
    const r = await createFollowup(v, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath('/admin/prc/followups');
    return r;
  });
}

/** F-ADM-CSL-12 안전사고 접수 → 자동 수신자 통보, 언론·인터넷이면 재확인 후 경영진 통보(BR-060·061) */
export async function submitIncident(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'CREATE');
    const v = parse(incidentInput, values);
    const r = await createIncident(v, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath('/admin/voc/incidents');
    return r;
  });
}
