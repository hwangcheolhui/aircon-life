// 기사 웹앱 진입 경로(/tech). 기사 화면(T-AUTH-010 등)은 단계 4-1부터 구현한다(04 §2).
export default function TechHome() {
  return (
    <main className="tec-page">
      <div className="tec-page__body">
        <section className="tec-section">
          <h1 className="ac-h1">기사 앱</h1>
          <p className="ac-body ac-caption">기사 화면은 배정·일정 단계에서 열립니다.</p>
        </section>
      </div>
    </main>
  );
}
