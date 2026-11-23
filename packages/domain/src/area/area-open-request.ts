/**
 * 서비스 지역 오픈 알림 신청 (01 §2.2.7 area_open_request, §3.9 상태, BR-003).
 * F-CUS-QUO-08 신청 · F-ADM-DSP-11 오픈 안내 · F-SYS-19 재시도·만료. 브라우저·서버 공용(Node 전용 API 없음).
 */
import { normalizePhone } from '../pii/mask';

export const AREA_OPEN_STATUSES = ['WAITING', 'NOTIFIED', 'EXPIRED'] as const;
export type AreaOpenStatus = (typeof AREA_OPEN_STATUSES)[number];

/** 01 §3.9 다음 가능 상태 (단일 출처) */
export const AREA_OPEN_TRANSITIONS: Readonly<Record<AreaOpenStatus, readonly AreaOpenStatus[]>> = {
  WAITING: ['NOTIFIED', 'EXPIRED'],
  NOTIFIED: [],
  EXPIRED: [],
};

export function canTransitionAreaOpen(from: string, to: AreaOpenStatus): boolean {
  return (AREA_OPEN_TRANSITIONS[from as AreaOpenStatus] ?? []).includes(to);
}

export function assertAreaOpenTransition(from: string, to: AreaOpenStatus): void {
  if (!canTransitionAreaOpen(from, to))
    throw new Error(`오픈 알림 신청 상태를 ${from}에서 ${to}(으)로 바꿀 수 없습니다.`);
}

/** 안내·만료 처리 대상이 되는 상태 (전이표에서 파생) */
export const AREA_OPEN_PENDING_STATUSES: readonly AreaOpenStatus[] = AREA_OPEN_STATUSES.filter((s) =>
  canTransitionAreaOpen(s, 'NOTIFIED'),
);

/** BR-003 휴대폰 번호(010·011·016~019, 10~11자리)만 받는다 — 문자·알림톡을 받을 수 있는 번호 */
export function isMobilePhone(phone: string): boolean {
  return /^01[016789]\d{7,8}$/.test(normalizePhone(phone));
}

/** BR-003 관할 지역 저장 결과가 "오픈"인지: 서비스 가능 + 법정동 코드 있음 */
export function shouldNotifyAreaOpened(area: {
  isServiceable: boolean;
  legalDongCode: string | null;
}): boolean {
  return area.isServiceable && Boolean(area.legalDongCode);
}

/** BR-003 대기 보관일(system_setting AREA_OPEN_REQUEST_KEEP_DAYS) 경과 여부 */
export function isAreaOpenRequestExpired(createdAt: Date, keepDays: number, now: Date): boolean {
  if (!Number.isInteger(keepDays) || keepDays < 1)
    throw new Error('오픈 알림 신청 보관일(AREA_OPEN_REQUEST_KEEP_DAYS)은 1 이상 정수여야 합니다.');
  return now.getTime() > createdAt.getTime() + keepDays * 24 * 60 * 60 * 1000;
}

/** 보관일 기준 만료 경계 시각: 이 시각 이전에 만든 대기 신청은 만료 대상 */
export function areaOpenExpireBefore(now: Date, keepDays: number): Date {
  isAreaOpenRequestExpired(now, keepDays, now); // 값 검증
  return new Date(now.getTime() - keepDays * 24 * 60 * 60 * 1000);
}

export function areaDisplayName(a: { sido: string; sigungu: string; eupmyeondong: string }): string {
  return [a.sido, a.sigungu, a.eupmyeondong].filter(Boolean).join(' ');
}

/**
 * 템플릿 `AREA_OPENED` 문구. notification_template(단계 2)이 생기기 전까지 임시로 여기에 둔다(04 단계 1 구현 메모).
 * 템플릿 테이블이 생기면 같은 코드로 옮기고 이 상수는 시드값으로만 쓴다.
 */
export const AREA_OPENED_TEMPLATE = {
  templateCode: 'AREA_OPENED',
  title: '서비스 지역 오픈 안내',
  body: '[에어컨 청소] 신청하신 #{지역명}에서 서비스를 시작했어요. 지금 견적을 받아 보세요.\n이 안내는 오픈 알림을 신청하셔서 1회만 보내 드립니다.',
} as const;

export function renderAreaOpenedMessage(vars: { areaName: string }): string {
  return AREA_OPENED_TEMPLATE.body.replaceAll('#{지역명}', vars.areaName);
}
