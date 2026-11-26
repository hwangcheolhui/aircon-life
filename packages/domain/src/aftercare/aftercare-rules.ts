/**
 * 사후관리 업무 규칙 (단계 8-1, 04 §2 단계 8): AS·VOC·안전사고·독촉/전달.
 * - BR-050 AS 보증 판정(완료일 + 상품 보증기간 안이면 무상, 재방문 주문 금액 0원)
 * - BR-051 AS 귀책 기사 기록(원 작업 주기사) — 서버가 responsible_tech_id 로 남기고 집계(F-SYS-11)에 반영
 * - BR-060 매체/기관에 언론·인터넷이 있으면 재확인 후 경영진 자동 통보
 * - BR-061 안전사고 등록 시 거점장·담당자 자동 수신자
 * 상태 전이표는 01 §3.12~3.15 와 같다. 상태 변경은 반드시 이 함수들을 거친다(CLAUDE.md §5).
 */
import { MSG } from '../messages';
import { kstDate, kstYymmdd } from '../quote/quote-status';

/* ---------- 공통: 번호 ---------- */

/** VOC `V`·안전사고 `S`·AS `A` 번호 = 접두 + 한국 날짜 YYMMDD + 그날 4자리 일련 (01 §2.6.4·2.6.6·2.12.8) */
export function formatAfterNo(prefix: 'V' | 'S' | 'A', at: Date, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > 9999) throw new Error('하루에 만들 수 있는 번호를 넘었습니다.');
  return `${prefix}${kstYymmdd(at)}${String(seq).padStart(4, '0')}`;
}

function makeTransitions<S extends string>(name: string, table: Readonly<Record<S, readonly S[]>>, initial: readonly S[]) {
  const can = (from: string | null, to: S) => (from === null ? initial.includes(to) : (table[from as S] ?? []).includes(to));
  const assert = (from: string | null, to: S) => {
    if (!can(from, to)) throw new Error(`${name} 상태를 ${from ?? '(신규)'}에서 ${to}(으)로 바꿀 수 없습니다.`);
  };
  return { can, assert };
}

/* ---------- AS (BR-050·051, F-CUS-AS-01, F-ADM-VOC-03) ---------- */

export const AS_STATUSES = ['REQUESTED', 'ACCEPTED', 'SCHEDULED', 'DONE', 'REJECTED'] as const;
export type AsStatus = (typeof AS_STATUSES)[number];
/** 01 §3.12: 접수 → 승인(보증 판정) → 재방문 예정(재방문 주문 생성) → 완료 / 접수·승인에서 반려 */
export const AS_TRANSITIONS: Readonly<Record<AsStatus, readonly AsStatus[]>> = {
  REQUESTED: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['SCHEDULED', 'REJECTED'],
  SCHEDULED: ['DONE'],
  DONE: [],
  REJECTED: [],
};
const asT = makeTransitions('AS', AS_TRANSITIONS, ['REQUESTED']);
export const canTransitionAs = asT.can;
export const assertAsTransition = asT.assert;
/** 진행 중 AS (같은 주문에 하나만) */
export const OPEN_AS_STATUSES: readonly AsStatus[] = ['REQUESTED', 'ACCEPTED', 'SCHEDULED'];
export const AS_REASONS = ['DIRT_REMAIN', 'LEAK', 'NOISE', 'ODOR', 'BROKEN'] as const;

/** 상품 보증기간 기본값(일) — service_product.warranty_days 기본값과 같다(01 §2.3.2) */
const DEFAULT_WARRANTY_DAYS = 30;

/**
 * BR-050 보증 판정: 완료일(한국 날짜) + 보증기간(주문 상품 중 가장 긴 값) 이 지나지 않았으면 무상.
 * until = 무상 AS 마지막 날(포함).
 */
export function asWarrantyOf(i: { completedAt: Date | null; warrantyDays: readonly number[]; now: Date }): { isWarranty: boolean; until: string | null; days: number } {
  const days = i.warrantyDays.length ? Math.max(...i.warrantyDays) : DEFAULT_WARRANTY_DAYS;
  if (!i.completedAt) return { isWarranty: false, until: null, days };
  const base = new Date(`${kstDate(i.completedAt)}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  const until = base.toISOString().slice(0, 10);
  return { isWarranty: kstDate(i.now) <= until, until, days };
}

/** F-CUS-AS-01 AS 요청 가능: 작업완료·완료 주문이고 진행 중 AS가 없을 때 */
export function canRequestAs(i: { orderStatus: string; orderType: string; openAsCount: number }): { ok: true } | { ok: false; reason: string } {
  if (i.orderStatus !== 'WORK_DONE' && i.orderStatus !== 'COMPLETED') return { ok: false, reason: '작업이 끝난 예약만 AS를 요청할 수 있어요.' };
  if (i.openAsCount > 0) return { ok: false, reason: '이미 접수된 AS 요청이 있어요. 처리 결과를 기다려 주세요.' };
  return { ok: true };
}

export interface RevisitSourceItem {
  itemType: string;
  productId: number | null;
  quantity: number;
  unitPrice: number;
}

/**
 * BR-050 재방문 주문 항목: 원 주문의 상품 항목만 옮긴다(옵션·할증·할인은 제외).
 * 무상이면 단가 0원, 유상이면 원 주문 견적 시점 단가(스냅샷, BR-014) 그대로.
 */
export function revisitOrderItems(items: readonly RevisitSourceItem[], isWarranty: boolean) {
  return items
    .filter((x) => x.itemType === 'PRODUCT')
    .map((x) => {
      const unitPrice = isWarranty ? 0 : x.unitPrice;
      return { itemType: 'PRODUCT', productId: x.productId, quantity: x.quantity, unitPrice, amount: unitPrice * x.quantity };
    });
}

/* ---------- VOC (F-ADM-VOC-01) ---------- */

export const VOC_STATUSES = ['RECEIVED', 'CONFIRMING', 'PROCESSING', 'DONE'] as const;
export type VocStatus = (typeof VOC_STATUSES)[number];
/** 01 §3.13: 접수 → 확정중 → 처리중 → 완료 (앞 단계로 건너뛰기 허용, 완료 후 변경 불가) */
export const VOC_TRANSITIONS: Readonly<Record<VocStatus, readonly VocStatus[]>> = {
  RECEIVED: ['CONFIRMING', 'PROCESSING', 'DONE'],
  CONFIRMING: ['PROCESSING', 'DONE'],
  PROCESSING: ['DONE'],
  DONE: [],
};
const vocT = makeTransitions('VOC', VOC_TRANSITIONS, ['RECEIVED']);
export const canTransitionVoc = vocT.can;
export const assertVocTransition = vocT.assert;
export const OPEN_VOC_STATUSES: readonly VocStatus[] = ['RECEIVED', 'CONFIRMING', 'PROCESSING'];

/** 불만 VOC 완료 조건: 원인·고객 조치 필수 */
export function checkVocClose(v: { vocType: string; rootCause: string | null; customerAction: string | null }): string | null {
  if (v.vocType !== 'COMPLAINT') return null;
  if (!v.rootCause?.trim()) return MSG.required('원인');
  if (!v.customerAction?.trim()) return MSG.required('고객 조치');
  return null;
}

/** 등급 HIGH 는 기본 경보(화면에서 바꿀 수 있음) */
export const defaultVocAlert = (severity: string | null | undefined) => severity === 'HIGH';

/** 상담 클레임 세부 유형(INQUIRY_SUB_TYPE) → VOC 대/중분류(VOC_CATEGORY_L·M) */
export function claimCategoryOf(subType: string | null | undefined): { l: string; m: string | null } {
  switch (subType) {
    case 'QUALITY':
      return { l: 'QUALITY', m: 'QUALITY_DIRT' };
    case 'ATTITUDE':
      return { l: 'ATTITUDE', m: 'ATTITUDE_RUDE' };
    case 'EXTRA_CHARGE':
      return { l: 'PRICE', m: 'PRICE_EXTRA' };
    case 'DELAY':
      return { l: 'SCHEDULE', m: 'SCHEDULE_DELAY' };
    default:
      return { l: 'ETC', m: null };
  }
}

/* ---------- 안전사고 (BR-060·061, F-ADM-CSL-12, F-ADM-VOC-02) ---------- */

export const MEDIA_FLAGS = ['PRESS', 'INTERNET', 'POLICE', 'FIRE', 'INSURANCE', 'ETC'] as const;
export type MediaFlag = (typeof MEDIA_FLAGS)[number];
/** BR-060 경영진 보고 대상 매체 */
export const ESCALATION_MEDIA: readonly MediaFlag[] = ['PRESS', 'INTERNET'];

export function parseMediaFlags(raw: string | null | undefined): MediaFlag[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is MediaFlag => (MEDIA_FLAGS as readonly string[]).includes(s));
}

/** BR-060 언론·인터넷이 하나라도 있으면 경영진 보고 대상(is_escalated) */
export const needsEscalation = (flags: readonly string[]) => flags.some((f) => (ESCALATION_MEDIA as readonly string[]).includes(f));

export type IncidentRecipientType = 'BRANCH_MANAGER' | 'OWNER' | 'EXECUTIVE' | 'MANUAL';

/**
 * BR-061 자동 수신자: 사고 거점의 거점장(ADM_BRANCH) = BRANCH_MANAGER, 거점 운영 담당(ADM_OPS) = OWNER.
 * BR-060 보고 대상이면 경영진(ADM_SUPER) = EXECUTIVE 를 더한다. 같은 관리자는 한 번만(앞 유형 우선).
 */
export function autoIncidentRecipients(i: {
  branchId: number | null;
  admins: readonly { id: number; roleCode: string; branchId: number | null }[];
  escalated: boolean;
}): { adminUserId: number; recipientType: IncidentRecipientType }[] {
  const out: { adminUserId: number; recipientType: IncidentRecipientType }[] = [];
  const add = (id: number, t: IncidentRecipientType) => {
    if (!out.some((r) => r.adminUserId === id)) out.push({ adminUserId: id, recipientType: t });
  };
  if (i.branchId !== null) {
    for (const a of i.admins) if (a.roleCode === 'ADM_BRANCH' && a.branchId === i.branchId) add(a.id, 'BRANCH_MANAGER');
    for (const a of i.admins) if (a.roleCode === 'ADM_OPS' && a.branchId === i.branchId) add(a.id, 'OWNER');
  }
  if (i.escalated) for (const a of i.admins) if (a.roleCode === 'ADM_SUPER') add(a.id, 'EXECUTIVE');
  return out;
}

/** 안전사고 필수 입력·길이(01 §2.6.4: 경위·요구 4,000자, 피해·조치 2,000자) */
export function checkIncidentInput(v: {
  damageType: string;
  circumstance: string;
  damageDetail: string;
  customerDemand?: string | null;
  responseAction?: string | null;
}): string | null {
  if (!v.damageType) return MSG.required('피해 유형');
  if (!v.circumstance.trim()) return MSG.required('발생 경위');
  if (!v.damageDetail.trim()) return MSG.required('피해 내용');
  if (v.circumstance.length > 4000) return '발생 경위는 4,000자 이내로 입력하세요.';
  if (v.damageDetail.length > 2000) return '피해 내용은 2,000자 이내로 입력하세요.';
  if ((v.customerDemand ?? '').length > 4000) return '고객 요구사항은 4,000자 이내로 입력하세요.';
  if ((v.responseAction ?? '').length > 2000) return '응대 조치는 2,000자 이내로 입력하세요.';
  return null;
}

export const INCIDENT_STATUSES = ['REPORTED', 'INVESTIGATING', 'NEGOTIATING', 'COMPENSATED', 'CLOSED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
/** 01 §3.14: 접수 → 조사 → 협의 → 보상 완료 → 종결 (앞으로만, 종결은 어디서나) */
export const INCIDENT_TRANSITIONS: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = {
  REPORTED: ['INVESTIGATING', 'NEGOTIATING', 'COMPENSATED', 'CLOSED'],
  INVESTIGATING: ['NEGOTIATING', 'COMPENSATED', 'CLOSED'],
  NEGOTIATING: ['COMPENSATED', 'CLOSED'],
  COMPENSATED: ['CLOSED'],
  CLOSED: [],
};
const incT = makeTransitions('안전사고', INCIDENT_TRANSITIONS, ['REPORTED']);
export const canTransitionIncident = incT.can;
export const assertIncidentTransition = incT.assert;

/* ---------- 독촉·전달 (F-ADM-CSL-11, F-TEC-NTF-02, F-ADM-PRC-08) ---------- */

/** 전달 내용 최대 글자 수(01 §2.6.3 "80자 제한 권장", 기사 앱 알림 한 화면) */
export const FOLLOWUP_MESSAGE_MAX = 80;

/** 같은 주문 기준 다음 독촉 회차 */
export const nextFollowupCount = (previous: readonly number[]) => (previous.length ? Math.max(...previous) : 0) + 1;

export function checkFollowupInput(v: { targetType: 'CONSULT' | 'ORDER'; targetOrderId: number | null; message: string; receiverAdminId: number | null }): string | null {
  if (v.targetType === 'ORDER' && !v.targetOrderId) return MSG.required('대상 주문');
  if (!v.message.trim()) return MSG.required('전달 내용');
  if (v.message.trim().length > FOLLOWUP_MESSAGE_MAX) return `전달 내용은 ${FOLLOWUP_MESSAGE_MAX}자 이내로 입력하세요.`;
  if (v.targetType === 'CONSULT' && !v.receiverAdminId) return MSG.required('받을 담당자');
  return null;
}

/** 받는 사람: 출장 독촉은 주문의 주기사(없으면 지정한 관리자), 상담 독촉은 지정한 관리자 */
export function followupReceiverOf(i: { targetType: 'CONSULT' | 'ORDER'; mainTechId: number | null; receiverAdminId: number | null }): { techId: number | null; adminId: number | null } | null {
  if (i.targetType === 'ORDER' && i.mainTechId) return { techId: i.mainTechId, adminId: null };
  if (i.receiverAdminId) return { techId: null, adminId: i.receiverAdminId };
  return null;
}

export const FOLLOWUP_STATUSES = ['SENT', 'READ', 'REPLIED', 'CLOSED'] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];
/** 01 §3.15: 발송 → 읽음 → 회신 → 종결 (읽음 없이 회신·종결 가능) */
export const FOLLOWUP_TRANSITIONS: Readonly<Record<FollowupStatus, readonly FollowupStatus[]>> = {
  SENT: ['READ', 'REPLIED', 'CLOSED'],
  READ: ['REPLIED', 'CLOSED'],
  REPLIED: ['CLOSED'],
  CLOSED: [],
};
const fuT = makeTransitions('독촉·전달', FOLLOWUP_TRANSITIONS, ['SENT']);
export const canTransitionFollowup = fuT.can;
export const assertFollowupTransition = fuT.assert;
