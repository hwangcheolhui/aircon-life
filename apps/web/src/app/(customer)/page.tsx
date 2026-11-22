// 고객 웹 진입 경로(/). 고객 화면(C-HOM-010 등)은 단계 1부터 구현한다(04 §2).
export default function CustomerHome() {
  return (
    <main className="ac-container ac-stack" style={{ paddingBlock: 'var(--space-12)' }}>
      <h1 className="ac-h1">에어컨 청소</h1>
      <p className="ac-body ac-caption">고객 화면은 다음 단계(견적)에서 열립니다.</p>
    </main>
  );
}
