// 단계 8 대시보드·통계 공용 단일 계열 막대 (A-DSH-020 매출 추이, A-STA-010 기간별 매출). 값·라벨은 텍스트 토큰, 호버/포커스 툴팁, 표는 화면 아래에 함께 둔다
export function Bars({ title, items }: { title: string; items: { label: string; value: number; display: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <figure className="ac-stack" aria-label={title}>
      <div className="adm-bars" role="list">
        {items.map((i) => (
          <div key={i.label} className="adm-bars__col" role="listitem" tabIndex={0} aria-label={`${i.label} ${i.display}`}>
            <span className="adm-bars__tip ac-num">
              {i.label} · {i.display}
            </span>
            <span className="adm-bars__bar" style={{ height: `${Math.max(0, (i.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="adm-bars__labels ac-num" aria-hidden>
        {items.map((i) => (
          <span key={i.label}>{i.label}</span>
        ))}
      </div>
    </figure>
  );
}
