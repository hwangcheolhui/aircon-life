// A-PRD-011 상품 관리 (상품 목록·상세: 기기형태×작업범위, 소요시간, 인원·숙련, 포함/불포함, 보증기간) · F-ADM-PRD-01
import { serviceCategory, serviceProduct } from '@aircon/db';
import { asc, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { ProductsScreen } from './screen';

export default async function ProductsPage() {
  const admin = await requireScreen('A-PRD-011');
  const db = getDb();
  const [rows, cats, codes] = await Promise.all([
    db.select().from(serviceProduct).where(isNull(serviceProduct.deletedAt)).orderBy(asc(serviceProduct.productCode)),
    db.select().from(serviceCategory).orderBy(asc(serviceCategory.sortOrder)),
    loadCodes(['DEVICE_TYPE', 'CLEAN_LEVEL', 'TECH_GRADE']),
  ]);
  return (
    <ProductsScreen
      rows={rows}
      categories={cats.map((c) => ({ value: String(c.id), label: c.name }))}
      codes={codes}
      {...screenFlags(admin, 'A-PRD-011')}
    />
  );
}
