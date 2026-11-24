// A-PRC-010 처리 콘솔 (+ A-PRC-020 처리 정보 영역) · F-ADM-PRC-01·02·06·07 (03 §4.3 레이아웃).
// 기사명(동명이인 선택)·접수번호·전화로 조회 → 기사 접수 목록(이관 → 미처리 → 진행 → 처리, 처리 건은 하단 노란 배경) →
// 처리 정보: 기사 대신 처리 저장(BR-041 전·후 사진, BR-043 안전 확인)·미처리 저장(BR-031), 안전관리·서비스 파일, 활동내역, 하단 탭(사진·활동·상태이력·결제).
import { hasPermission, kstDate, shiftDate } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { consoleDetail, consoleOrders, techById } from '@/server/process-console';
import { ConsoleScreen } from './screen';

export const dynamic = 'force-dynamic';

type SP = { tech?: string; no?: string; phone?: string; from?: string; to?: string; order?: string };
const ymd = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const idOf = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

export default async function ProcessConsolePage({ searchParams }: { searchParams: Promise<SP> }) {
  const admin = await requireScreen('A-PRC-010');
  const sp = await searchParams;
  const filter = await currentBranchFilter(admin);
  const today = kstDate(new Date());
  const from = ymd(sp.from) ?? shiftDate(today, -7);
  const to = ymd(sp.to) ?? shiftDate(today, 7);
  const techId = idOf(sp.tech);
  const q = { techId, orderNo: sp.no?.trim() || null, phone: sp.phone?.trim() || null, from, to };
  const [rows, tech, codes] = await Promise.all([
    consoleOrders(q, filter),
    techId ? techById(techId, filter) : Promise.resolve(null),
    loadCodes(['PENDING_REASON', 'RESULT_CODE', 'WORK_RESULT', 'ACTIVITY_TYPE', 'PAYMENT_METHOD', 'PAYMENT_TX_STATUS', 'PAYMENT_STATUS', 'ASSIGN_ROLE']),
  ]);
  const orderId = idOf(sp.order) ?? (rows.length === 1 ? rows[0]!.id : null);
  const detail = orderId ? await consoleDetail(orderId, filter).catch(() => null) : null;
  const live = !admin.preview;
  return (
    <ConsoleScreen
      query={{ ...q, techName: tech?.name ?? '' }}
      searched={Boolean(techId || q.orderNo || q.phone)}
      rows={rows}
      detail={detail}
      codes={codes}
      today={today}
      canUpdate={hasPermission(admin, 'A-PRC-010', 'UPDATE') && live}
      canCreate={hasPermission(admin, 'A-PRC-010', 'CREATE') && live}
      canDelete={hasPermission(admin, 'A-PRC-010', 'DELETE') && live}
    />
  );
}
