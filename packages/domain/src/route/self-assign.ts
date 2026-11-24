/**
 * 관할 내 미배정 작업 담기·위치 규칙 (단계 4-2: F-TEC-RTE-04, F-TEC-AUTH-02, BR-110·111·115).
 * - BR-110: 기사 지도에는 내 배정 작업 전부 + 내 관할 법정동(technician_area) 안의 배정 전(RECEIVED·ASSIGN_WAIT) 작업만.
 *   미배정 작업은 오늘~daysAhead(7)일 이내 약속만 보인다(02 F-TEC-RTE-04 표시 조건).
 * - BR-111: 자가 배정은 주 관할(priority 1)만 설정에 따라 즉시 확정, 보조 관할(priority 2)·2인 작업은 운영자 승인.
 * - F-TEC-RTE-04 활성 조건: 숙련 CAN_SOLO 이상, 그날 근무, 코스에 넣어도 시간창 위반 없음 + 배정 가능 기사(BR-070·071).
 * - BR-115: 위치는 위치정보 동의 + 근무 시작~종료 사이에만. 고객에게는 좌표 대신 시각만.
 */
import { needsAccompany } from '../dispatch/assignment-rules';

/** 배정 전 주문 상태 (배정 보드의 "배정대기"와 같은 범위) */
export const UNASSIGNED_ORDER_STATUSES = ['RECEIVED', 'ASSIGN_WAIT'] as const;

export interface SelfAssignOrder {
  status: string;
  legalDongCode: string | null;
  /** 약속일 YYYY-MM-DD (KST) */
  date: string | null;
  deviceTypes: readonly string[];
  requiredTechCount: number;
}

export interface AreaRow {
  code: string;
  /** 1=주 관할, 2=보조 관할 */
  priority: number;
}

const addDays = (ymd: string, n: number) =>
  new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** BR-110 미배정 작업 표시 여부 */
export function isUnassignedVisible(
  o: SelfAssignOrder,
  areas: readonly AreaRow[],
  today: string,
  daysAhead: number,
): boolean {
  if (!(UNASSIGNED_ORDER_STATUSES as readonly string[]).includes(o.status)) return false;
  if (!o.legalDongCode || !areas.some((a) => a.code === o.legalDongCode)) return false;
  if (!o.date || o.date < today || o.date > addDays(today, daysAhead)) return false;
  return true;
}

export interface SelfAssignCheck {
  visible: boolean;
  canRequest: boolean;
  needsApproval: boolean;
  reasons: string[];
}

export function checkSelfAssign(i: {
  /** SELF_ASSIGN_ENABLED */
  enabled: boolean;
  /** SELF_ASSIGN_NEEDS_APPROVAL */
  needsApprovalSetting: boolean;
  order: SelfAssignOrder;
  tech: {
    status: string;
    grade: string;
    accompanyDoneCount: number;
    accompanyRequiredCount: number;
    skills: readonly { deviceType: string; skillLevel: string }[];
  };
  areas: readonly AreaRow[];
  today: string;
  daysAhead: number;
  /** 그날 근무(근무 유형이 근무·반차·당직이고 시간이 있음) */
  working: boolean;
  /** 코스에 넣어도 기존·새 지점 시간창 위반 없음 */
  insertionOk: boolean;
}): SelfAssignCheck {
  const visible = isUnassignedVisible(i.order, i.areas, i.today, i.daysAhead);
  if (!visible)
    return {
      visible,
      canRequest: false,
      needsApproval: true,
      reasons: ['내 관할 구역의 배정 전 작업이 아닙니다.'],
    };
  const reasons: string[] = [];
  if (!i.enabled) reasons.push('거점에서 자가 배정을 사용하지 않습니다.');
  if (i.tech.status !== 'ACTIVE' || needsAccompany(i.tech))
    reasons.push('교육·동행 중에는 직접 작업을 담을 수 없습니다.');
  const solo = new Set(['CAN_SOLO', 'CAN_TEACH']);
  if (
    new Set(i.order.deviceTypes).size === 0 ||
    [...new Set(i.order.deviceTypes)].some(
      (d) => !i.tech.skills.some((s) => s.deviceType === d && solo.has(s.skillLevel)),
    )
  )
    reasons.push('이 기기를 단독으로 작업할 숙련이 없습니다.');
  if (!i.working) reasons.push('그날은 근무일이 아닙니다.');
  if (!i.insertionOk) reasons.push('코스에 넣으면 도착 허용 시간을 지킬 수 없습니다.');
  const primary = i.areas.some((a) => a.code === i.order.legalDongCode && a.priority === 1);
  const needsApproval = i.needsApprovalSetting || !primary || i.order.requiredTechCount >= 2;
  return { visible, canRequest: reasons.length === 0, needsApproval, reasons };
}

/* ---------- BR-115 ---------- */

export function canCollectLocation(t: {
  locationAgreedAt: Date | null;
  dutyStartedAt: Date | null;
}): boolean {
  return t.locationAgreedAt !== null && t.dutyStartedAt !== null;
}

/**
 * 고객 예약 상세(C-ORD-020) 방문 예정 시간: 코스가 확정되어 안내가 나간 배정완료 주문만 시각을 보여 준다.
 * 이동중(ON_THE_WAY) 도착 예정시각은 단계 5(출발)에서 붙인다. 좌표는 어떤 경우에도 돌려주지 않는다.
 */
export function customerVisitTime(i: {
  orderStatus: string;
  routeStatus: string | null;
  notifiedArrival: Date | null;
}): { kind: 'PLANNED'; at: Date } | null {
  if (i.orderStatus !== 'ASSIGNED' || !i.notifiedArrival) return null;
  if (i.routeStatus !== 'CONFIRMED' && i.routeStatus !== 'IN_PROGRESS') return null;
  return { kind: 'PLANNED', at: i.notifiedArrival };
}
