// C-ORD-050 작업 리포트 · F-CUS-ORD-05: 기기별 작업 전·후 사진, 처리 내용, 발견 이슈, 차기 권장 시기 (작업완료·완료 주문만)
// 사진은 /api/files/{id} 가 본인 주문인지 확인한 뒤에만 내려준다. 안전관리·증빙 사진과 내부 메모는 보여 주지 않는다.
import { Alert, Card, Tag } from '@aircon/ui';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDateTime, formatDuration } from '@/customer/format';
import { loadCodes } from '@/server/codes';
import { requireCustomer } from '@/server/customer-session';
import { getWorkReport } from '@/server/work';

export const metadata = { title: '작업 리포트' };
export const dynamic = 'force-dynamic';

/** 완료일 + n개월 → 2027년 11월 */
function monthsLater(from: Date, n: number) {
  const [y, m] = from.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).split('-').map(Number);
  const t = y! * 12 + (m! - 1) + n;
  return `${Math.floor(t / 12)}년 ${(t % 12) + 1}월`;
}

export default async function WorkReportPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const me = await requireCustomer(`/orders/${orderNo}/report`);
  const r = me.demo ? null : await getWorkReport(me.id, orderNo);
  if (!r) notFound();
  const codes = await loadCodes(['WORK_RESULT', 'DIRT_LEVEL', 'PHOTO_TYPE']);
  const label = (g: string, v: string | null) => (v ? (codes[g]?.find((c) => c.value === v)?.label ?? v) : '');
  const next = r.devices.map((d) => d.recommendNext).filter((n): n is number => n !== null);
  return (
    <main className="cus-page-body">
      <div className="cus-topbar">
        <Link href={`/orders/${r.orderNo}`} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="예약 상세">
          <ChevronLeft aria-hidden />
        </Link>
        <span className="ac-caption ac-num">{r.orderNo}</span>
      </div>
      <div>
        <h1 className="ac-h2">작업 리포트</h1>
        <p className="ac-caption ac-num">
          {r.finishedAt ? `${formatDateTime(r.finishedAt)} 완료` : ''}
          {r.workMinutes ? ` · 작업 ${formatDuration(r.workMinutes)}` : ''}
          {r.techName ? ` · ${r.techName} 기사님` : ''}
        </p>
      </div>
      <Card>
        <h2 className="ac-h3" style={{ marginTop: 0 }}>
          처리 내용
        </h2>
        <p className="ac-body cus-report-note">{r.workNote}</p>
        {r.dirtLevel ? <p className="ac-caption">현장 오염도: {label('DIRT_LEVEL', r.dirtLevel)}</p> : null}
        {next.length ? (
          <p className="ac-body">
            다음 청소 권장 <strong className="ac-num">{r.finishedAt ? monthsLater(r.finishedAt, Math.min(...next)) : `${Math.min(...next)}개월 뒤`}</strong>
          </p>
        ) : null}
      </Card>
      {r.issueFound ? (
        <Alert tone="warning">
          발견된 이슈: {r.issueFound}
          {r.repairGuided ? ' (기사님이 수리를 안내해 드렸어요)' : ''}
        </Alert>
      ) : null}
      {r.devices.map((d) => (
        <Card key={`${d.orderItemId}:${d.unitNo}`}>
          <div className="cus-report-head">
            <h2 className="ac-h3" style={{ margin: 0 }}>
              {d.label}
            </h2>
            {d.result ? <Tag tone={d.result === 'DONE' ? 'success' : 'warning'}>{label('WORK_RESULT', d.result)}</Tag> : null}
          </div>
          {d.conditionNote ? <p className="ac-caption">{d.conditionNote}</p> : null}
          {(['BEFORE', 'AFTER', 'DURING', 'ISSUE'] as const).map((t) => {
            const ps = d.photos.filter((p) => p.photoType === t);
            if (!ps.length) return null;
            return (
              <div key={t} className="cus-report-photos">
                <h3 className="ac-body-sm">{label('PHOTO_TYPE', t)}</h3>
                <div className="ac-photo-grid">
                  {ps.map((p) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="ac-photo-slot">
                      <img src={p.url} alt={`${d.label} ${label('PHOTO_TYPE', t)} 사진`} loading="lazy" />
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </Card>
      ))}
      {r.issuePhotos.length ? (
        <Card>
          <h2 className="ac-h3" style={{ marginTop: 0 }}>
            추가 사진
          </h2>
          <div className="ac-photo-grid">
            {r.issuePhotos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="ac-photo-slot">
                <img src={p.url} alt={`${label('PHOTO_TYPE', p.photoType)} 사진`} loading="lazy" />
              </a>
            ))}
          </div>
        </Card>
      ) : null}
    </main>
  );
}
