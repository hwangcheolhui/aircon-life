// C-HOM-010 홈 · F-CUS-HOM-01(일부): 단계 1은 "견적 받기" CTA만. 진행 중 예약 카드 등은 단계 2 이후(04 §3).
import Link from 'next/link';
import '@/customer/customer.css';

export default function CustomerHome() {
  return (
    <main className="ac-container">
      <section className="cus-home-hero">
        <h1 className="ac-display">에어컨 청소, 표준 가격으로</h1>
        <p className="ac-body-lg">위치와 기기, 대수만 고르면 로그인 없이 바로 견적을 알려 드려요.</p>
        <div>
          <Link href="/quote" className="ac-btn ac-btn--primary ac-btn--xl">
            견적 받기
          </Link>
        </div>
      </section>
    </main>
  );
}
