// T-MAT-020 자재 요청 · F-TEC-MAT-02: 자재·수량·필요일·관련 접수번호로 요청, 내 요청 목록(상태 배지), 요청 취소·수령 확인
// 불출(A-TEC-060)은 단계 11. 그 전에는 거점에서 직접 받은 뒤 [수령 확인]을 누르면 보유 수량이 늘어난다(01_ERD §3.19)
import { kstDate } from '@aircon/domain';
import { Empty } from '@aircon/ui';
import { loadCodes } from '@/server/codes';
import { activeMaterials, listTechMaterialRequests } from '@/server/tech-support';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';
import { MaterialRequestForm, MaterialRequestRow } from './request-form';

export const metadata = { title: '자재 요청' };
export const dynamic = 'force-dynamic';

export default async function TechMaterialRequestsPage() {
  const me = await requireTech();
  const [materials, rows, codes] = await Promise.all([activeMaterials(), listTechMaterialRequests(me.id), loadCodes(['MATERIAL_REQUEST_STATUS'])]);
  const label = (v: string) => codes.MATERIAL_REQUEST_STATUS?.find((c) => c.value === v)?.label ?? v;
  return (
    <main className="tec-page__body">
      <TechTopbar title="자재 요청" back={{ href: '/tech/materials', label: '보유 자재로' }} />
      <MaterialRequestForm materials={materials} today={kstDate(new Date())} />
      <section className="tec-section" aria-labelledby="req-title">
        <h2 id="req-title" className="ac-h3">
          내 요청
        </h2>
        {rows.length ? (
          <ul className="tec-job-list">
            {rows.map((r) => (
              <li key={r.id}>
                <MaterialRequestRow
                  row={{
                    id: r.id,
                    materialName: r.materialName,
                    unit: r.unit,
                    quantity: r.quantity,
                    neededDate: r.neededDate,
                    status: r.status,
                    statusLabel: label(r.status),
                    orderNo: r.orderNo,
                  }}
                />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>조회 결과가 없습니다.</Empty>
        )}
      </section>
    </main>
  );
}
