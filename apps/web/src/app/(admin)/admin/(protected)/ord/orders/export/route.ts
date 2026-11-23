// A-ORD-010 주문 목록 CSV 다운로드 · F-ADM-ORD-01 (EXPORT 권한 + 감사 로그, 개인정보는 마스킹 값만)
import type { NextRequest } from 'next/server';
import { exportOrders } from '@/server/admin-orders';
import { writeAudit } from '@/server/audit';
import { ForbiddenError, requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { formatDateTime } from '@/customer/format';
import { parseOrderQuery } from '../query';

/** 엑셀이 한글을 깨뜨리지 않도록 UTF-8 BOM */
const BOM = String.fromCharCode(0xfeff);
const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export async function GET(req: NextRequest) {
  let admin;
  try {
    admin = await requirePermission('A-ORD-010', 'EXPORT');
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response(e.message, { status: 403 });
    throw e;
  }
  const q = parseOrderQuery(Object.fromEntries(req.nextUrl.searchParams));
  const rows = await exportOrders(await currentBranchFilter(admin), q);
  await writeAudit({ actorId: admin.adminId, action: 'EXPORT', targetTable: 'service_order', detail: { query: q, count: rows.length } });
  const codes = await loadCodes(['ORDER_STATUS', 'ORDER_CHANNEL', 'PAYMENT_STATUS']);
  const label = (g: string, v: string) => codes[g]?.find((c) => c.value === v)?.label ?? v;
  const header = ['접수번호', '상태', '접수일시', '방문 예정', '거점', '고객번호', '고객', '연락처', '주소', '채널', '금액', '결제'];
  const lines = rows.map((r) =>
    [
      r.orderNo,
      label('ORDER_STATUS', r.status),
      formatDateTime(r.createdAt),
      formatDateTime(r.promisedAt),
      r.branchName,
      r.customerNo,
      r.customerName,
      r.phoneMasked,
      r.roadAddress,
      label('ORDER_CHANNEL', r.channel),
      r.totalAmount,
      label('PAYMENT_STATUS', r.paymentStatus),
    ]
      .map(csv)
      .join(','),
  );
  const body = `${BOM}${[header.map(csv).join(','), ...lines].join('\r\n')}`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
