/**
 * 배정 검증 (F-ADM-DSP-01·03, 단계 4-1). 배정 보드에서 기사를 고를 때 막을 것(BLOCK)과 알리기만 할 것(WARN)을 나눈다.
 * - BLOCK: BR-070(기사 상태), BR-071(견습 초기 동행), BR-072(CAN_ASSIST만 → 지원 역할만), 2인 작업 지원기사 필수, 같은 기사 중복
 * - WARN : 근무 일정 없음·휴무·근무 시간 밖, 이동 버퍼 포함 시간 겹침, 숙련 미등록 기기(BR-072), 활동지역 밖
 * 운영자는 WARN을 보고도 배정할 수 있다(02 F-ADM-DSP-01 "경고").
 */
import { hoursOf } from '../slot/slot';

export const ASSIGN_ROLES = ['MAIN', 'SUPPORT', 'ACCOMPANY'] as const;
export type AssignRole = (typeof ASSIGN_ROLES)[number];

/** 01 §2.7.2 technician_skill.skill_level */
export const SKILL_LEVELS = ['CAN_ASSIST', 'CAN_SOLO', 'CAN_TEACH'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export interface AssignTech {
  id: number;
  name: string;
  /** TECH_STATUS */
  status: string;
  /** TECH_GRADE */
  grade: string;
  accompanyRequiredCount: number;
  accompanyDoneCount: number;
  skills: readonly { deviceType: string; skillLevel: string }[];
  /** 활동지역(technician_area) 법정동 코드 */
  areaCodes: readonly string[];
}

export interface AssignOrder {
  /** 주문 기기 유형(DEVICE_TYPE) */
  deviceTypes: readonly string[];
  legalDongCode: string | null;
  start: Date;
  end: Date;
  requiredTechCount: number;
}

export interface DaySchedule {
  scheduleType: string;
  startTime: string | null;
  endTime: string | null;
}

export interface BusyRange {
  orderNo: string;
  start: Date;
  end: Date;
}

export type IssueCode =
  | 'NOT_ASSIGNABLE'
  | 'TRAINING_ACCOMPANY_ONLY'
  | 'ACCOMPANY_REQUIRED'
  | 'ASSIST_ONLY'
  | 'NO_SKILL'
  | 'NO_SCHEDULE'
  | 'OFF_DAY'
  | 'OUT_OF_HOURS'
  | 'OVERLAP'
  | 'OUT_OF_AREA'
  | 'NO_AREA'
  | 'SUPPORT_REQUIRED'
  | 'ACCOMPANY_NEEDS_LEADER'
  | 'DUPLICATE_TECH';

export interface AssignIssue {
  code: IssueCode;
  level: 'BLOCK' | 'WARN';
  message: string;
  /** 어느 기사에 대한 것인지 (계획 단위 검증이면 null) */
  technicianId: number | null;
}

export const blocking = (issues: readonly AssignIssue[]) => issues.filter((i) => i.level === 'BLOCK');

const ROLE_NAME: Record<AssignRole, string> = { MAIN: '주기사', SUPPORT: '지원기사', ACCOMPANY: '교육 동행' };

/** BR-071 견습 기사가 초기 동행(기본 3건, 설정값으로 기사별 필요 건수에 들어감)을 아직 마치지 않았는지 */
export function needsAccompany(t: Pick<AssignTech, 'grade' | 'accompanyDoneCount' | 'accompanyRequiredCount'>): boolean {
  return t.grade === 'TRAINEE' && t.accompanyDoneCount < t.accompanyRequiredCount;
}

const kstMinutes = (d: Date) => ((d.getUTCHours() + 9) % 24) * 60 + d.getUTCMinutes();

/** 기사 1명을 한 역할로 배정할 때의 검증 */
export function checkTechForRole(i: {
  tech: AssignTech;
  role: AssignRole;
  order: AssignOrder;
  schedule: DaySchedule | null;
  busy: readonly BusyRange[];
  /** 이동 버퍼(분, ASSIGN_TRAVEL_BUFFER_MIN) */
  bufferMin: number;
  defaults: { defaultStart: string; defaultEnd: string };
}): AssignIssue[] {
  const { tech: t, role } = i;
  const out: AssignIssue[] = [];
  const add = (code: IssueCode, level: AssignIssue['level'], message: string) => out.push({ code, level, message, technicianId: t.id });

  // BR-070 기사 상태
  if (t.status !== 'ACTIVE' && t.status !== 'TRAINING') {
    add('NOT_ASSIGNABLE', 'BLOCK', `${t.name} 기사는 활동 중이 아니라 배정할 수 없습니다.`);
  } else if (t.status === 'TRAINING' && role !== 'ACCOMPANY') {
    add('TRAINING_ACCOMPANY_ONLY', 'BLOCK', `${t.name} 기사는 교육중이라 교육 동행으로만 배정할 수 있습니다.`);
  }
  // BR-071 견습 초기 동행
  if (role !== 'ACCOMPANY' && needsAccompany(t)) {
    add('ACCOMPANY_REQUIRED', 'BLOCK', `${t.name} 기사는 동행 ${t.accompanyDoneCount}/${t.accompanyRequiredCount}건이라 아직 교육 동행으로만 배정할 수 있습니다.`);
  }
  // BR-072 숙련
  if (role !== 'ACCOMPANY') {
    const missing: string[] = [];
    let assistOnly = false;
    for (const d of new Set(i.order.deviceTypes)) {
      const s = t.skills.find((x) => x.deviceType === d);
      if (!s) missing.push(d);
      else if (s.skillLevel === 'CAN_ASSIST') assistOnly = true;
    }
    if (assistOnly && role === 'MAIN') add('ASSIST_ONLY', 'BLOCK', `${t.name} 기사는 이 기기를 보조만 할 수 있어 지원기사로만 배정할 수 있습니다.`);
    if (missing.length) add('NO_SKILL', 'WARN', `${t.name} 기사의 숙련에 없는 기기가 있습니다.`);
  }
  // 근무 일정
  if (!i.schedule) {
    add('NO_SCHEDULE', 'WARN', `${t.name} 기사는 그날 근무 일정이 없습니다.`);
  } else {
    const hours = hoursOf({ technicianId: t.id, workDate: '', ...i.schedule }, i.defaults);
    if (hours.length === 0) add('OFF_DAY', 'WARN', `${t.name} 기사는 그날 휴무입니다.`);
    else {
      const s = kstMinutes(i.order.start);
      const e = kstMinutes(i.order.end) || 24 * 60;
      const from = Math.min(...hours) * 60;
      const to = (Math.max(...hours) + 1) * 60;
      if (s < from || e > to) add('OUT_OF_HOURS', 'WARN', `${t.name} 기사의 근무 시간 밖 약속입니다.`);
    }
  }
  // 시간 겹침 (이동 버퍼 포함)
  const buf = i.bufferMin * 60_000;
  const clash = i.busy.find((b) => b.start.getTime() < i.order.end.getTime() + buf && b.end.getTime() + buf > i.order.start.getTime());
  if (clash) add('OVERLAP', 'WARN', `${t.name} 기사의 다른 약속(${clash.orderNo})과 겹칩니다(이동 ${i.bufferMin}분 포함).`);
  // 활동지역
  if (t.areaCodes.length === 0) add('NO_AREA', 'WARN', `${t.name} 기사는 활동지역이 지정되지 않았습니다.`);
  else if (i.order.legalDongCode && !t.areaCodes.includes(i.order.legalDongCode)) add('OUT_OF_AREA', 'WARN', `${t.name} 기사의 활동지역 밖 주소입니다.`);

  return out.map((x) => (x.level === 'BLOCK' ? { ...x, message: `[${ROLE_NAME[role]}] ${x.message}` } : x));
}

/** 배정 계획(주기사 + 지원기사 + 교육 동행) 단위 검증 */
export function checkAssignmentPlan(p: {
  order: Pick<AssignOrder, 'requiredTechCount'>;
  main: AssignTech;
  support: AssignTech | null;
  accompany: AssignTech | null;
}): AssignIssue[] {
  const out: AssignIssue[] = [];
  if (p.order.requiredTechCount >= 2 && !p.support) {
    out.push({ code: 'SUPPORT_REQUIRED', level: 'BLOCK', message: '2인 작업은 지원기사를 추가해야 확정할 수 있습니다.', technicianId: null });
  }
  const ids = [p.main, p.support, p.accompany].filter((t): t is AssignTech => t !== null).map((t) => t.id);
  if (new Set(ids).size !== ids.length) {
    out.push({ code: 'DUPLICATE_TECH', level: 'BLOCK', message: '같은 기사를 두 역할에 넣을 수 없습니다.', technicianId: null });
  }
  if (p.accompany && p.main.grade !== 'LEADER') {
    out.push({ code: 'ACCOMPANY_NEEDS_LEADER', level: 'BLOCK', message: '교육 동행은 팀장 기사가 주기사일 때만 넣을 수 있습니다.', technicianId: null });
  }
  return out;
}

/** F-SYS-09 BR-024 미지정(ASSIGN_WAIT) 건 중 약속이 hours 시간 이내(이미 지난 약속 포함)인지 */
export function isUnassignedUrgent(o: { status: string; promisedAt: Date | null }, now: Date, hours: number): boolean {
  if (o.status !== 'ASSIGN_WAIT' || !o.promisedAt) return false;
  return o.promisedAt.getTime() - now.getTime() <= hours * 3600_000;
}
