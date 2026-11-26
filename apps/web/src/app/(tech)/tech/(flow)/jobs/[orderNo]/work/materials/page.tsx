// T-WRK-050 자재 사용 (단계 9) · F-TEC-WRK-06: 자재 검색·수량·고객 청구 여부. 청구 자재는 추가요금(MATERIAL)으로 고객 동의(BR-040)
import { notFound } from 'next/navigation';
import { loadCodes } from '@/server/codes';
import { getMaterialScreen } from '@/server/materials';
import { MaterialBoard } from '@/tech/work/material-board';
import { WorkSteps } from '@/tech/work/work-steps';
import { loadStep } from '../load';

export const metadata = { title: '자재 사용' };

export default async function WorkMaterialsPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const { me } = await loadStep(orderNo, 'materials');
  const [s, codes] = await Promise.all([getMaterialScreen(me.id, orderNo).catch(() => null), loadCodes(['MATERIAL_UNIT'])]);
  if (!s) notFound();
  return (
    <main className="tec-page__body">
      <WorkSteps orderNo={orderNo} current="materials" title="자재 사용" />
      <MaterialBoard s={s} units={codes.MATERIAL_UNIT ?? []} />
    </main>
  );
}
