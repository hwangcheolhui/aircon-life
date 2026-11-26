// A-STA-010 [CSV 다운로드] · F-ADM-STA-01: 기간별 매출·환불·순매출 + 기준별 매출. EXPORT 권한 + 감사 로그(02 §7 다운로드 기록)
import type { NextRequest } from 'next/server';
import { writeAudit } from '@/server/audit';
import { ForbiddenError, requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { salesStats } from '@/server/ops';
import { salesQueryOf } from '../query';

const BOM = String.fromCharCode(0xfeff);
const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export async function GET(req: NextRequest) {
  let admin;
  try {
    admin = await requirePermission('A-STA-010', 'EXPORT');
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response(e.message, { status: 403 });
    throw e;
  }
  const q = salesQueryOf(Object.fromEntries(req.nextUrl.searchParams));
  const d = await salesStats(await currentBranchFilter(admin), q);
  await writeAudit({ actorId: admin.adminId, action: 'EXPORT', targetTable: 'service_order', detail: { screen: 'A-STA-010', ...q } });
  const lines = [
    ['기간', '매출', '건수', '환불', '순매출'].map(csv).join(','),
    ...d.buckets.map((b) => [b.key, b.revenue, b.count, b.refund, b.revenue - b.refund].map(csv).join(',')),
    '',
    ['기준', '매출', '건수'].map(csv).join(','),
    ...d.groups.map((g) => [g.label, g.revenue, g.count].map(csv).join(',')),
  ];
  return new Response(`${BOM}${lines.join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sales-${q.from}-${q.to}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
