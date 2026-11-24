// A-STL-020 [지급 파일] · F-ADM-STL-04: 은행 대량이체 CSV(은행코드·계좌번호·예금주·금액·적요). 계좌 원문이 들어가므로 EXPORT 권한 + 감사 로그(BR-100).
// 실지급액 0원 이하·계좌 없는 기사는 파일에서 빠진다(지급 완료 창에서 따로 안내). 송금 API 연동은 이후 단계.
import type { NextRequest } from 'next/server';
import { ForbiddenError, requirePermission } from '@/server/auth';
import { UserError } from '@/server/action-result';
import { currentBranchFilter } from '@/server/branch-selection';
import { transferFile } from '@/server/settlements';

/** 엑셀이 한글을 깨뜨리지 않도록 UTF-8 BOM */
const BOM = String.fromCharCode(0xfeff);
const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let admin;
  try {
    admin = await requirePermission('A-STL-020', 'EXPORT');
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response(e.message, { status: 403 });
    throw e;
  }
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response('잘못된 회차입니다.', { status: 400 });
  try {
    const r = await transferFile(id, await currentBranchFilter(admin), admin.adminId);
    const header = ['은행코드', '계좌번호', '예금주', '금액', '적요', '기사코드'];
    const lines = r.transfers.map((t) =>
      [t.bankCode, t.bankAccount, t.accountHolder ?? t.techName, t.netPay, `정산 ${r.batch.batchNo}`, t.techCode].map(csv).join(','),
    );
    const body = `${BOM}${[header.map(csv).join(','), ...lines].join('\r\n')}`;
    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="transfer-${r.batch.batchNo}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof UserError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
