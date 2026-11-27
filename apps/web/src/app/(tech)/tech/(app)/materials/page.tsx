// T-MAT-010 보유 자재 · F-TEC-MAT-01: 자재별 보유 수량, 안전재고 미달 강조(색 + 글자). 수령 확인 시 +, 현장 자재 사용(T-WRK-050) 시 −
import { Empty, Tag } from '@aircon/ui';
import Link from 'next/link';
import { listTechStock } from '@/server/tech-support';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';

export const metadata = { title: '보유 자재' };
export const dynamic = 'force-dynamic';

export default async function TechMaterialsPage() {
  const me = await requireTech();
  const rows = await listTechStock(me.id);
  const below = rows.filter((r) => r.below).length;
  return (
    <main className="tec-page__body">
      <TechTopbar title="보유 자재" back={{ href: '/tech/more', label: '더보기로' }} />
      <div className="tec-head-row">
        <p className="ac-body">{below ? <>안전재고 미달 <strong className="ac-num">{below}</strong>개</> : '안전재고 미달 자재가 없습니다.'}</p>
        <Link href="/tech/materials/requests" className="ac-btn ac-btn--outline ac-btn--sm">
          자재 요청
        </Link>
      </div>
      {rows.length ? (
        <ul className="ac-list">
          {rows.map((r) => (
            <li key={r.id} className="ac-list-item">
              <div className="ac-list-item__body">
                <span className="ac-body">{r.name}</span>
                <span className="ac-caption ac-num"> {r.code}</span>
                {r.safetyStock ? <p className="ac-caption ac-num">안전재고 {r.safetyStock}{r.unit}</p> : null}
              </div>
              {r.below ? <Tag tone="danger">부족</Tag> : null}
              <strong className="ac-num">
                {r.quantity}
                {r.unit}
              </strong>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>조회 결과가 없습니다.</Empty>
      )}
    </main>
  );
}
