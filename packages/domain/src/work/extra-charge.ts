/**
 * 현장 추가요금 (01 §2.9.4 extra_charge, 단계 5-2) · F-TEC-WRK-05 등록 · F-CUS-ORD-04 고객 동의 · F-ADM-PRC-04 관리자 승인.
 * BR-040 고객 동의(앱 확인 또는 현장 서명) 없는 추가요금은 청구하지 않는다.
 * BR-042 사전공개 규칙 밖(ETC) 추가요금은 관리자 승인 후에만 고객 동의를 요청한다.
 * 상태는 별도 컬럼 없이 approval_status · customer_agreed · agreed_at(고객 응답 시각) · deleted_at(기사 철회)로 정한다.
 */
import { MSG } from '../messages';

/** EXTRA_CHARGE_TYPE: RULE 사전공개 규칙 / MATERIAL 자재 구매 / ETC 기타(관리자 승인) / DEVICE_ADD 현장 기기 추가 */
export const EXTRA_CHARGE_TYPES = ['RULE', 'MATERIAL', 'ETC', 'DEVICE_ADD'] as const;
export type ExtraChargeType = (typeof EXTRA_CHARGE_TYPES)[number];

/** EXTRA_AGREED_METHOD: APP_CONFIRM 고객 앱 / SIGNATURE 현장 서명 */
export const EXTRA_AGREED_METHODS = ['APP_CONFIRM', 'SIGNATURE'] as const;

export type ExtraChargeState = 'WAIT_APPROVAL' | 'REJECTED' | 'WAIT_CUSTOMER' | 'AGREED' | 'DECLINED' | 'WITHDRAWN';

export interface ExtraChargeLike {
  chargeType: string;
  approvalStatus: string | null;
  customerAgreed: boolean;
  agreedAt: Date | null;
  deletedAt: Date | null;
}

/** BR-042 등록 시 승인 상태: 기타만 승인 요청 */
export function approvalStatusFor(chargeType: string): 'REQUESTED' | 'NOT_REQUIRED' {
  return chargeType === 'ETC' ? 'REQUESTED' : 'NOT_REQUIRED';
}

export function extraChargeState(c: ExtraChargeLike): ExtraChargeState {
  if (c.deletedAt) return 'WITHDRAWN';
  if (c.approvalStatus === 'REQUESTED') return 'WAIT_APPROVAL';
  if (c.approvalStatus === 'REJECTED') return 'REJECTED';
  if (!c.agreedAt) return 'WAIT_CUSTOMER';
  return c.customerAgreed ? 'AGREED' : 'DECLINED';
}

/** 고객(앱)·현장 서명으로 응답할 수 있는 상태 */
export function canCustomerRespond(c: ExtraChargeLike): boolean {
  return extraChargeState(c) === 'WAIT_CUSTOMER';
}

/** 기사가 철회할 수 있는 상태(응답 전) */
export function canWithdrawExtra(c: ExtraChargeLike): boolean {
  const s = extraChargeState(c);
  return s === 'WAIT_APPROVAL' || s === 'WAIT_CUSTOMER';
}

/** BR-040 동의된 추가요금 합계만 청구 */
export function agreedExtraTotal(list: readonly (ExtraChargeLike & { amount: number })[]): number {
  return list.filter((c) => extraChargeState(c) === 'AGREED').reduce((s, c) => s + c.amount, 0);
}

/** 완료를 막는 응답 전 추가요금 수 (승인 대기 포함) — F-TEC-WRK-07 ④ */
export function pendingExtraCount(list: readonly ExtraChargeLike[]): number {
  return list.filter((c) => canWithdrawExtra(c)).length;
}

export interface ExtraChargeInputCheck {
  chargeType: string;
  title: string;
  amount: number;
  reason: string;
  hasEvidence: boolean;
  hasRule: boolean;
  quantity: number;
  /** 단계 9 자재 사용(T-WRK-050)에서 만든 청구 자재: 자재 마스터 판매가(사전 공개 단가)라 증빙 사진을 받지 않는다 */
  fromMaterialMaster?: boolean;
}

/** F-TEC-WRK-05 입력 검증 (필드명 → 메시지). 규칙은 규칙 선택, 자재·기타는 증빙 사진, 사유는 모두 필수 */
export function checkExtraChargeInput(i: ExtraChargeInputCheck): Record<string, string> {
  const e: Record<string, string> = {};
  if (!(EXTRA_CHARGE_TYPES as readonly string[]).includes(i.chargeType)) e.chargeType = MSG.required('유형');
  if (i.chargeType === 'RULE' && !i.hasRule) e.surchargeRuleId = MSG.required('추가요금 규칙');
  if (i.chargeType === 'DEVICE_ADD' && !(i.quantity >= 1)) e.quantity = '추가 대수는 1대 이상이어야 합니다.';
  if (!i.title.trim()) e.title = MSG.required('항목명');
  if (!Number.isInteger(i.amount) || i.amount < 1) e.amount = '금액은 1원 이상이어야 합니다.';
  if (!i.reason.trim()) e.reason = MSG.required('사유');
  if ((i.chargeType === 'ETC' || (i.chargeType === 'MATERIAL' && !i.fromMaterialMaster)) && !i.hasEvidence) e.evidence = MSG.required('증빙 사진');
  return e;
}

/** 사전공개 규칙(ON_SITE) 금액: 정액(대당이면 × 대수) 또는 정률(작업비 × %, 원 미만 버림) — 견적 할증과 같은 계산 */
export function ruleChargeAmount(rule: { amountType: string; amount: number; perUnit: boolean }, units: number, laborAmount: number): number {
  if (rule.amountType === 'RATE') return Math.floor((laborAmount * rule.amount) / 100);
  return rule.amount * (rule.perUnit ? Math.max(units, 1) : 1);
}
