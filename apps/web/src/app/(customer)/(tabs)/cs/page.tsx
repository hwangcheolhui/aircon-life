// C-CS-010 고객센터 · F-CUS-CS-01(FAQ) · F-CUS-CS-03(전화 연결). 단계 8: FAQ는 A-CNT-020에서 게시한 고객 FAQ(faq), 분류별 묶음 + 1:1 문의(C-CS-020) 진입
import { branch } from '@aircon/db';
import { Card } from '@aircon/ui';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import Link from 'next/link';
import { loadCodes } from '@/server/codes';
import { publishedFaqs } from '@/server/content';
import { getDb, isDbConfigured } from '@/server/db';

export const metadata = { title: '고객센터' };
export const dynamic = 'force-dynamic';

export default async function CsPage() {
  const live = isDbConfigured();
  const [phones, faqs, codes] = live
    ? await Promise.all([
        getDb()
          .select({ name: branch.name, phone: branch.phone })
          .from(branch)
          .where(and(eq(branch.status, 'ACTIVE'), isNull(branch.deletedAt), isNotNull(branch.phone)))
          .orderBy(asc(branch.name)),
        publishedFaqs('CUSTOMER'),
        loadCodes(['FAQ_CATEGORY']),
      ])
    : [[], [], {} as Awaited<ReturnType<typeof loadCodes>>];
  const groups = (codes.FAQ_CATEGORY ?? []).map((c) => ({ ...c, items: faqs.filter((f) => f.category === c.value) })).filter((g) => g.items.length);
  return (
    <main className="cus-page-body">
      <h1 className="ac-h2">고객센터</h1>
      <Card>
        <h2 className="ac-h3 cus-card-title">자주 묻는 질문</h2>
        {groups.length === 0 ? (
          <p className="ac-body-sm">등록된 질문이 없어요.</p>
        ) : (
          groups.map((g) => (
            <section key={g.value} aria-label={g.label}>
              <h3 className="ac-title">{g.label}</h3>
              {g.items.map((f) => (
                <details key={f.id} className="ac-body cus-faq">
                  <summary>{f.question}</summary>
                  <p className="ac-body-sm">{f.answer}</p>
                </details>
              ))}
            </section>
          ))
        )}
      </Card>
      <Link href="/cs/inquiries" className="ac-btn ac-btn--outline ac-btn--lg ac-btn--block">
        1:1 문의하기
      </Link>
      <Card>
        <h2 className="ac-h3 cus-card-title">전화 상담</h2>
        {phones.length === 0 ? (
          <p className="ac-body-sm">등록된 상담 전화가 없어요.</p>
        ) : (
          phones.map((p) => (
            <a key={p.name} href={`tel:${p.phone}`} className="ac-btn ac-btn--outline ac-btn--block cus-phone">
              {p.name} <span className="ac-num">{p.phone}</span>
            </a>
          ))
        )}
      </Card>
    </main>
  );
}
