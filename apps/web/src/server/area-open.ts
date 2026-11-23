import 'server-only';
/**
 * 서비스 지역 오픈 알림 신청·안내 서버 서비스 (01 §2.2.7 area_open_request, §3.9, BR-003).
 * - F-CUS-QUO-08 신청 저장 (requestAreaOpen)
 * - F-ADM-DSP-11 관할 지역을 서비스 가능으로 저장하면 그 법정동 대기 신청자에게 안내 (notifyAreaOpened)
 * - F-SYS-19 실패분 재발송·보관일 경과 만료 (runAreaOpenJob)
 * 상태 변경은 domain 전이표(AREA_OPEN_TRANSITIONS)를 거친다(CLAUDE.md §5).
 */
import { areaOpenRequest, serviceArea } from '@aircon/db';
import {
  AREA_OPENED_TEMPLATE,
  SETTING_KEYS,
  areaDisplayName,
  areaOpenExpireBefore,
  assertAreaOpenTransition,
  renderAreaOpenedMessage,
  shouldNotifyAreaOpened,
} from '@aircon/domain';
import { type NotifyTransport, createNotifyTransport, sendWithFallback } from '@aircon/integrations';
import type { areaOpenRequestInput, z } from '@aircon/contracts';
import { and, asc, count, eq, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from './db';
import { decrypt, encrypt, phoneHash } from './pii';
import { isQuoteDemoMode } from './quote-demo';
import { findServiceArea } from './quote';
import { getSettingNumber } from './settings';

type Db = ReturnType<typeof getDb>;
const WAITING = 'WAITING';

export type AreaOpenRequestResult =
  | { kind: 'SAVED' }
  /** 서버에서 다시 보니 이미 서비스 가능 지역 (BR-001) */
  | { kind: 'ALREADY_SERVICEABLE' }
  /** DB 미연결 체험 모드: 저장하지 않음 */
  | { kind: 'DEMO' };

/** F-CUS-QUO-08 오픈 알림 신청 저장 (BR-003: 비서비스 지역만, 같은 지역+번호 대기 1건) */
export async function requestAreaOpen(
  input: z.output<typeof areaOpenRequestInput>,
  db: Db = getDb(),
  now = new Date(),
): Promise<AreaOpenRequestResult> {
  if (isQuoteDemoMode()) return { kind: 'DEMO' };
  const area = await findServiceArea(input.legalDongCode, db);
  if (area.serviceable) return { kind: 'ALREADY_SERVICEABLE' };
  const hash = phoneHash(input.phone);
  const [dup] = await db
    .select({ id: areaOpenRequest.id })
    .from(areaOpenRequest)
    .where(
      and(
        eq(areaOpenRequest.legalDongCode, input.legalDongCode),
        eq(areaOpenRequest.phoneHash, hash),
        eq(areaOpenRequest.status, WAITING),
      ),
    );
  if (dup) return { kind: 'SAVED' }; // 이미 대기 중이면 같은 결과로 응답(번호 존재 여부를 드러내지 않음)
  await db
    .insert(areaOpenRequest)
    .values({
      legalDongCode: input.legalDongCode,
      sido: input.sido,
      sigungu: input.sigungu,
      eupmyeondong: input.eupmyeondong,
      phone: encrypt(input.phone),
      phoneHash: hash,
      privacyAgreedAt: now,
      status: WAITING,
    })
    .onConflictDoNothing(); // 동시에 같은 신청이 들어와도 대기 1건 (area_open_request_waiting_uk)
  return { kind: 'SAVED' };
}

export interface NotifySummary {
  sent: number;
  failed: number;
}

/**
 * F-ADM-DSP-11 지역 오픈 안내. 그 법정동의 WAITING 신청마다 알림톡(실패 시 SMS) 1회.
 * 성공 → NOTIFIED + 연락처 삭제, 실패 → WAITING 유지·실패 횟수 기록(F-SYS-19가 재시도).
 * 같은 신청이 두 번 나가지 않게 행 잠금(FOR UPDATE SKIP LOCKED) 안에서 보내고 바꾼다.
 */
export async function notifyAreaOpened(
  area: { legalDongCode: string | null; isServiceable: boolean; branchId: number },
  opts: { actorId?: number | null; db?: Db; transport?: NotifyTransport; now?: Date } = {},
): Promise<NotifySummary> {
  const summary: NotifySummary = { sent: 0, failed: 0 };
  if (!shouldNotifyAreaOpened(area)) return summary;
  const db = opts.db ?? getDb();
  const transport = opts.transport ?? createNotifyTransport();
  const now = opts.now ?? new Date();
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(areaOpenRequest)
      .where(and(eq(areaOpenRequest.legalDongCode, area.legalDongCode!), eq(areaOpenRequest.status, WAITING)))
      .orderBy(asc(areaOpenRequest.id))
      .for('update', { skipLocked: true });
    for (const row of rows) {
      const phone = decrypt(row.phone);
      const text = renderAreaOpenedMessage({ areaName: areaDisplayName(row) });
      const r = phone
        ? await sendWithFallback(transport, {
            to: phone,
            text,
            title: AREA_OPENED_TEMPLATE.title,
            variables: { '#{지역명}': areaDisplayName(row) },
          })
        : { status: 'FAILED' as const, channel: null, failReason: '연락처 없음' };
      if (r.status === 'FAILED') {
        summary.failed++;
        await tx
          .update(areaOpenRequest)
          .set({
            notifyFailCount: sql`${areaOpenRequest.notifyFailCount} + 1`,
            lastFailReason: (r.failReason ?? '발송 실패').slice(0, 200),
            updatedAt: now,
            updatedBy: opts.actorId ?? null,
          })
          .where(eq(areaOpenRequest.id, row.id));
        continue;
      }
      assertAreaOpenTransition(row.status, 'NOTIFIED');
      summary.sent++;
      await tx
        .update(areaOpenRequest)
        .set({
          status: 'NOTIFIED',
          branchId: area.branchId,
          notifiedAt: now,
          notifyChannel: r.channel,
          phone: null, // BR-003 안내 후 연락처 삭제
          phoneHash: null,
          updatedAt: now,
          updatedBy: opts.actorId ?? null,
        })
        .where(eq(areaOpenRequest.id, row.id));
    }
  });
  return summary;
}

/** F-SYS-19 ① 서비스 가능 지역의 남은 대기 신청 재발송 ② 보관일 지난 대기 신청 만료·연락처 삭제 */
export async function runAreaOpenJob(now = new Date(), db: Db = getDb(), transport?: NotifyTransport) {
  const waitingCodes = db
    .selectDistinct({ code: areaOpenRequest.legalDongCode })
    .from(areaOpenRequest)
    .where(eq(areaOpenRequest.status, WAITING));
  const opened = await db
    .select({
      legalDongCode: serviceArea.legalDongCode,
      isServiceable: serviceArea.isServiceable,
      branchId: serviceArea.branchId,
    })
    .from(serviceArea)
    .where(and(eq(serviceArea.isServiceable, true), inArray(serviceArea.legalDongCode, waitingCodes)));
  const notified: NotifySummary = { sent: 0, failed: 0 };
  for (const a of opened) {
    const r = await notifyAreaOpened(a, { db, transport, now });
    notified.sent += r.sent;
    notified.failed += r.failed;
  }
  assertAreaOpenTransition(WAITING, 'EXPIRED');
  const keepDays = await getSettingNumber(SETTING_KEYS.AREA_OPEN_REQUEST_KEEP_DAYS);
  const expired = await db
    .update(areaOpenRequest)
    .set({ status: 'EXPIRED', phone: null, phoneHash: null, updatedAt: now, updatedBy: null })
    .where(
      and(
        eq(areaOpenRequest.status, WAITING),
        lt(areaOpenRequest.createdAt, areaOpenExpireBefore(now, keepDays)),
      ),
    )
    .returning({ id: areaOpenRequest.id });
  return { ...notified, expired: expired.length };
}

export interface AreaOpenDemand {
  legalDongCode: string;
  sido: string;
  sigungu: string;
  eupmyeondong: string;
  waiting: number;
}

/** A-DSP-050 지역별 대기 신청 건수 (번호는 보여 주지 않는다, 01 §6) */
export async function areaOpenWaitingByDong(db: Db = getDb()): Promise<AreaOpenDemand[]> {
  const rows = await db
    .select({
      legalDongCode: areaOpenRequest.legalDongCode,
      sido: sql<string>`min(${areaOpenRequest.sido})`,
      sigungu: sql<string>`min(${areaOpenRequest.sigungu})`,
      eupmyeondong: sql<string>`min(${areaOpenRequest.eupmyeondong})`,
      waiting: count(),
    })
    .from(areaOpenRequest)
    .where(eq(areaOpenRequest.status, WAITING))
    .groupBy(areaOpenRequest.legalDongCode);
  return rows.map((r) => ({ ...r, waiting: Number(r.waiting) })).sort((a, b) => b.waiting - a.waiting);
}
