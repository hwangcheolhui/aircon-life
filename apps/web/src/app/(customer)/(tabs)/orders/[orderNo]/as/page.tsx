// C-AS-010 AS 요청 · F-CUS-AS-01: 사유 선택·사진(3장)·내용, 보증 여부 표시(BR-050), 진행 중 AS가 있으면 요청 불가(BR-051), 이 예약의 AS 이력
import { Alert, Card, Tag } from '@aircon/ui';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDateTime } from '@/customer/format';
import { loadCodes } from '@/server/codes';
import { requireCustomer } from '@/server/customer-session';
import { customerAsInfo } from '@/server/voc';
import { AsForm } from './as-form';

export const metadata = { title: 'AS 요청' };
export const dynamic = 'force-dynamic';

export default async function AsRequestPage({ params, searchParams }: { params: Promise<{ orderNo: string }>; searchParams: Promise<{ done?: string }> }) {
  const { orderNo } = await params;
  const { done } = await searchParams;
  const me = await requireCustomer(`/orders/${orderNo}/as`);
  const info = me.demo ? null : await customerAsInfo(me.id, orderNo);
  if (!info) notFound();
  const codes = await loadCodes(['AS_REASON', 'AS_STATUS']);
  const label = (g: string, v: string) => codes[g]?.find((c) => c.value === v)?.label ?? v;
  return (
    <main className="cus-page-body">
      <div className="cus-topbar">
        <Link href={`/orders/${orderNo}`} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="예약 상세">
          <ChevronLeft aria-hidden />
        </Link>
        <span className="ac-caption ac-num">{orderNo}</span>
      </div>
      <h1 className="ac-h2">AS 요청</h1>
      {done ? <Alert tone="success">AS 요청을 접수했어요. 확인 후 알림으로 안내해 드릴게요.</Alert> : null}
      <Card>
        {info.warranty.isWarranty ? (
          <p className="ac-body">
            <Tag tone="success">보증기간</Tag> <span className="ac-num">{info.warranty.until}</span>까지 무상으로 다시 봐 드려요.
          </p>
        ) : (
          <p className="ac-body">
            <Tag>보증기간 경과</Tag> 보증기간({info.warranty.days}일)이 지나 비용이 생길 수 있어요. 접수 후 안내해 드릴게요.
          </p>
        )}
      </Card>
      {info.allowed.ok ? <AsForm orderNo={orderNo} reasons={codes.AS_REASON ?? []} /> : <p className="ac-body-sm">{info.allowed.reason}</p>}
      {info.history.length ? (
        <Card>
          <h2 className="ac-h3">이 예약의 AS</h2>
          <ul className="ac-list">
            {info.history.map((h) => (
              <li key={h.asNo}>
                <Tag tone={h.status === 'DONE' ? 'success' : h.status === 'REJECTED' ? 'danger' : 'primary'}>{label('AS_STATUS', h.status)}</Tag> {label('AS_REASON', h.reason)} ·{' '}
                <span className="ac-num">{formatDateTime(new Date(h.createdAt))}</span>
                {h.status === 'REJECTED' && h.handleNote ? <p className="ac-caption">{h.handleNote}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </main>
  );
}
