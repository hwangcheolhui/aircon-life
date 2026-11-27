// T-EDU-010 기술자료 상세 · F-TEC-EDU-01: 내용 + 첨부(비공개 저장소 → /api/files/{id} 로만 연다)
import { Card, Tag } from '@aircon/ui';
import { FileText } from 'lucide-react';
import { notFound } from 'next/navigation';
import { loadCodes } from '@/server/codes';
import { getTechDoc } from '@/server/tech-docs';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';

export const metadata = { title: '기술자료' };
export const dynamic = 'force-dynamic';

export default async function TechDocDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireTech();
  const { id } = await params;
  if (!/^\d{1,15}$/.test(id)) notFound();
  const [d, codes] = await Promise.all([getTechDoc(Number(id)), loadCodes(['TECH_DOC_TYPE', 'DEVICE_TYPE'])]);
  if (!d) notFound();
  const label = (g: string, v: string | null) => (v ? (codes[g]?.find((c) => c.value === v)?.label ?? v) : '공통');
  return (
    <main className="tec-page__body">
      <TechTopbar title="기술자료" back={{ href: '/tech/docs', label: '기술자료 목록으로' }} />
      <div className="tec-job-card__top">
        {d.isRequiredRead ? <Tag tone="danger">필독</Tag> : null}
        <Tag>{label('TECH_DOC_TYPE', d.docType)}</Tag>
        <span className="ac-body-sm">{label('DEVICE_TYPE', d.deviceType)}</span>
        <span className="tec-job-card__time ac-caption ac-num">
          v{d.version} · {d.updatedAt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })}
        </span>
      </div>
      <h2 className="ac-h2">{d.title}</h2>
      <Card>
        <p className="ac-body tec-note">{d.content}</p>
      </Card>
      {d.files.length ? (
        <section className="tec-section" aria-labelledby="files-title">
          <h3 id="files-title" className="ac-h3">
            첨부
          </h3>
          <ul className="ac-list">
            {d.files.map((f) => (
              <li key={f.id} className="ac-list-item">
                <FileText aria-hidden />
                <a className="ac-list-item__body ac-body" href={`/api/files/${f.id}`} target="_blank" rel="noopener noreferrer">
                  {f.name}
                </a>
                <span className="ac-caption ac-num">{Math.max(1, Math.round(f.size / 1024))}KB</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
