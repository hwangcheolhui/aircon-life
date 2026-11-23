// C-ORD-030 일정 변경·취소 · F-CUS-ORD-03: 사유, 새 일정(잔여 슬롯), 취소 수수료 안내(BR-030)
import { canCustomerCancel } from '@aircon/domain';
import { notFound, redirect } from 'next/navigation';
import { requireCustomer } from '@/server/customer-session';
import { cancelPreview, getCustomerOrder, orderSlotTarget } from '@/server/orders';
import { getAvailability } from '@/server/slots';
import { ChangeForm } from './change-form';

export const metadata = { title: '일정 변경·취소' };
export const dynamic = 'force-dynamic';

export default async function ChangePage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const me = await requireCustomer(`/orders/${orderNo}/change`);
  const o = me.demo ? null : await getCustomerOrder(me.id, orderNo);
  if (!o) notFound();
  if (!canCustomerCancel(o.status)) redirect(`/orders/${orderNo}`);
  const hours = orderSlotTarget(o)?.hours.length ?? 1;
  const [days, preview] = await Promise.all([
    getAvailability({ branchId: o.branchId, durationMin: hours >= 2 ? hours * 60 : 60 }),
    cancelPreview(o),
  ]);
  return <ChangeForm orderNo={o.orderNo} days={days} preview={preview} paidAmount={o.paidAmount} />;
}
