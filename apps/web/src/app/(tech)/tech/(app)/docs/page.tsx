// T-EDU-010 기술자료 · F-TEC-EDU-01: 유형·기기 필터, 필독 먼저, 제목·버전·첨부 수. 상세에서 내용·첨부(PDF·이미지) 열람
import { Empty, Tag } from '@aircon/ui';
import { Paperclip } from 'lucide-react';
import Link from 'next/link';
import { loadCodes } from '@/server/codes';
import { listTechDocs } from '@/server/tech-docs';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';

export const metadata = { title: '기술자료' };
export const dynamic = 'force-dynamic';

export default async function TechDocsPage({ searchParams }: { searchParams: Promise<{ type?: string; device?: string }> }) {
  await requireTech();
  const sp = await searchParams;
  const codes = await loadCodes(['TECH_DOC_TYPE', 'DEVICE_TYPE']);
  const type = codes.TECH_DOC_TYPE?.some((c) => c.value === sp.type) ? sp.type! : null;
  const device = codes.DEVICE_TYPE?.some((c) => c.value === sp.device) ? sp.device! : null;
  const rows = await listTechDocs({ docType: type, deviceType: device });
  const label = (g: string, v: string | null) => (v ? (codes[g]?.find((c) => c.value === v)?.label ?? v) : '공통');
  const href = (t: string | null, d: string | null) => {
    const p = new URLSearchParams();
    if (t) p.set('type', t);
    if (d) p.set('device', d);
    const s = p.toString();
    return s ? `/tech/docs?${s}` : '/tech/docs';
  };
  return (
    <main className="tec-page__body">
      <TechTopbar title="기술자료" back={{ href: '/tech/more', label: '더보기로' }} />
      <nav className="ac-chip-row" aria-label="유형">
        <Link href={href(null, device)} className={`ac-chip${!type ? ' ac-chip--active' : ''}`} aria-current={!type ? 'page' : undefined}>
          전체
        </Link>
        {codes.TECH_DOC_TYPE?.map((c) => (
          <Link key={c.value} href={href(c.value, device)} className={`ac-chip${type === c.value ? ' ac-chip--active' : ''}`} aria-current={type === c.value ? 'page' : undefined}>
            {c.label}
          </Link>
        ))}
      </nav>
      <nav className="ac-chip-row" aria-label="기기">
        <Link href={href(type, null)} className={`ac-chip${!device ? ' ac-chip--active' : ''}`} aria-current={!device ? 'page' : undefined}>
          모든 기기
        </Link>
        {codes.DEVICE_TYPE?.map((c) => (
          <Link key={c.value} href={href(type, c.value)} className={`ac-chip${device === c.value ? ' ac-chip--active' : ''}`} aria-current={device === c.value ? 'page' : undefined}>
            {c.label}
          </Link>
        ))}
      </nav>
      {rows.length ? (
        <ul className="tec-job-list">
          {rows.map((d) => (
            <li key={d.id}>
              <Link href={`/tech/docs/${d.id}`} className="tec-job-card">
                <div className="tec-job-card__top">
                  {d.isRequiredRead ? <Tag tone="danger">필독</Tag> : null}
                  <Tag>{label('TECH_DOC_TYPE', d.docType)}</Tag>
                  <span className="ac-body-sm">{label('DEVICE_TYPE', d.deviceType)}</span>
                  <span className="tec-job-card__time ac-caption ac-num">v{d.version}</span>
                </div>
                <span className="ac-body">{d.title}</span>
                {d.fileCount ? (
                  <span className="ac-body-sm ac-num">
                    <Paperclip aria-hidden className="tec-inline-icon" /> 첨부 {d.fileCount}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>조회 결과가 없습니다.</Empty>
      )}
    </main>
  );
}
