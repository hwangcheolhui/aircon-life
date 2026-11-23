// C-CS-010 고객센터 · F-CUS-CS-01(FAQ) · F-CUS-CS-03(전화 연결). FAQ 테이블(faq) 컬럼이 ERD에 아직 정의되지 않아 자주 묻는 질문은 고정 안내로 두고, 운영 FAQ는 문서 확정 후 연결한다.
import { branch } from '@aircon/db';
import { Card } from '@aircon/ui';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { getDb } from '@/server/db';

export const metadata = { title: '고객센터' };
export const dynamic = 'force-dynamic';

const FAQ = [
  { q: '추가요금이 생길 수 있나요?', a: '오염이 심하거나 높은 곳 작업 등은 현장에서 기사님이 먼저 설명하고, 고객님이 동의한 경우에만 추가돼요.' },
  { q: '예약을 바꾸거나 취소하려면요?', a: '내 예약 > 예약 상세 > 일정 변경·취소에서 할 수 있어요. 기사님이 출발한 뒤에는 고객센터로 연락해 주세요.' },
  { q: '결제는 언제 하나요?', a: '예약할 때 미리 결제하거나, 방문한 날 현장에서 결제할 수 있어요.' },
];

export default async function CsPage() {
  const phones = await getDb()
    .select({ name: branch.name, phone: branch.phone })
    .from(branch)
    .where(and(eq(branch.status, 'ACTIVE'), isNull(branch.deletedAt), isNotNull(branch.phone)))
    .orderBy(asc(branch.name));
  return (
    <main className="cus-page-body">
      <h1 className="ac-h2">고객센터</h1>
      <Card>
        <h2 className="ac-h3" style={{ marginTop: 0 }}>
          자주 묻는 질문
        </h2>
        {FAQ.map((f) => (
          <details key={f.q} className="ac-body" style={{ padding: 'var(--space-2) 0' }}>
            <summary>{f.q}</summary>
            <p className="ac-body-sm">{f.a}</p>
          </details>
        ))}
      </Card>
      <Card>
        <h2 className="ac-h3" style={{ marginTop: 0 }}>
          전화 상담
        </h2>
        {phones.length === 0 ? (
          <p className="ac-body-sm">등록된 상담 전화가 없어요.</p>
        ) : (
          phones.map((p) => (
            <a key={p.name} href={`tel:${p.phone}`} className="ac-btn ac-btn--outline ac-btn--block" style={{ marginBottom: 'var(--space-2)' }}>
              {p.name} <span className="ac-num">{p.phone}</span>
            </a>
          ))
        )}
      </Card>
    </main>
  );
}
