/**
 * 첨부파일 내려받기 (단계 5-1: 작업 사진·고객 서명). 저장소는 비공개이고, 여기서 보는 사람을 확인한 뒤에만 파일을 준다.
 * 기사 = 그 주문에 확정 배정된 기사, 고객 = 본인 주문의 작업 리포트(C-ORD-050) 공개 이후 작업 전·중·후·이상 사진만.
 * 단계 5-2: 추가요금 증빙·서명 — 고객은 동의 요청된 건만, 관리자는 추가요금 승인(A-PRC-040) 조회 권한 + 거점 범위(BR-102).
 * 단계 6-2: 작업 사진·서명·안전관리·서비스 파일 — 관리자는 처리 콘솔(A-PRC-010) 조회 권한 + 거점 범위(BR-102).
 * 단계 8: AS 요청 사진(AS_REQUEST) — 고객 본인, 관리자는 AS 요청(A-VOC-030) 조회 권한 + 거점 범위(BR-102).
 */
import { hasPermission } from '@aircon/domain';
import { getCurrentAdmin } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { readAttachment } from '@/server/attachments';
import { getCurrentCustomer } from '@/server/customer-session';
import { isDbConfigured } from '@/server/db';
import { adminCanViewWorkFile } from '@/server/process-console';
import { getCurrentTech } from '@/server/tech-session';
import { asFileOwner } from '@/server/voc';
import { adminCanViewExtraFile, canViewAttachment, photoTypeOfFile } from '@/server/work';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!isDbConfigured() || !Number.isInteger(id) || id < 1) return new Response('Not found', { status: 404 });
  const [tech, customer, admin] = await Promise.all([getCurrentTech(), getCurrentCustomer(), getCurrentAdmin()]);
  if (!tech && !customer && (!admin || admin.preview)) return new Response('Unauthorized', { status: 401 });
  const f = await readAttachment(id);
  if (!f) return new Response('Not found', { status: 404 });
  if (f.row.refType === 'AS_REQUEST') {
    const owner = await asFileOwner(f.row.refId);
    const filter = admin && !admin.preview && hasPermission(admin, 'A-VOC-030', 'READ') ? await currentBranchFilter(admin) : null;
    const ok =
      owner &&
      ((customer && !customer.demo && customer.id === owner.customerId) ||
        (filter && (filter.kind === 'ALL' || (filter.kind === 'BRANCH' && filter.branchId === owner.branchId))));
    if (!ok) return new Response('Not found', { status: 404 });
    return new Response(Buffer.from(f.body), {
      headers: { 'Content-Type': f.row.mimeType.startsWith('image/') ? f.row.mimeType : 'application/octet-stream', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
    });
  }
  const photoType = await photoTypeOfFile(id);
  const allowed =
    (tech && (await canViewAttachment(f.row, { type: 'TECHNICIAN', id: tech.id }, photoType))) ||
    (customer && !customer.demo && (await canViewAttachment(f.row, { type: 'CUSTOMER', id: customer.id }, photoType))) ||
    (admin && !admin.preview && hasPermission(admin, 'A-PRC-040', 'READ') && (await adminCanViewExtraFile(f.row, await currentBranchFilter(admin)))) ||
    (admin && !admin.preview && hasPermission(admin, 'A-PRC-010', 'READ') && (await adminCanViewWorkFile(f.row, await currentBranchFilter(admin))));
  if (!allowed) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(f.body), {
    headers: {
      'Content-Type': f.row.mimeType.startsWith('image/') ? f.row.mimeType : 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
