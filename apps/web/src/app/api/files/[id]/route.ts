/**
 * 첨부파일 내려받기 (단계 5-1: 작업 사진·고객 서명). 저장소는 비공개이고, 여기서 보는 사람을 확인한 뒤에만 파일을 준다.
 * 기사 = 그 주문에 확정 배정된 기사, 고객 = 본인 주문의 작업 리포트(C-ORD-050) 공개 이후 작업 전·중·후·이상 사진만.
 */
import { readAttachment } from '@/server/attachments';
import { getCurrentCustomer } from '@/server/customer-session';
import { isDbConfigured } from '@/server/db';
import { getCurrentTech } from '@/server/tech-session';
import { canViewAttachment, photoTypeOfFile } from '@/server/work';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!isDbConfigured() || !Number.isInteger(id) || id < 1) return new Response('Not found', { status: 404 });
  const [tech, customer] = await Promise.all([getCurrentTech(), getCurrentCustomer()]);
  if (!tech && !customer) return new Response('Unauthorized', { status: 401 });
  const f = await readAttachment(id);
  if (!f) return new Response('Not found', { status: 404 });
  const photoType = await photoTypeOfFile(id);
  const allowed =
    (tech && (await canViewAttachment(f.row, { type: 'TECHNICIAN', id: tech.id }, photoType))) ||
    (customer && !customer.demo && (await canViewAttachment(f.row, { type: 'CUSTOMER', id: customer.id }, photoType)));
  if (!allowed) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(f.body), {
    headers: {
      'Content-Type': f.row.mimeType.startsWith('image/') ? f.row.mimeType : 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
