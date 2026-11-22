// A-PRD-020 가격 정책 (거점·기간·유형별 단가, 대수 할인, 적용 예정 가격 미리보기) · F-ADM-PRD-02
import { branch, pricePolicy, serviceProduct } from '@aircon/db';
import { asc, desc, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { PricesScreen } from './screen';

export default async function PricesPage() {
  const admin = await requireScreen('A-PRD-020');
  const db = getDb();
  const [rows, products, branches, codes] = await Promise.all([
    db.select().from(pricePolicy).orderBy(asc(pricePolicy.productId), desc(pricePolicy.priority), desc(pricePolicy.validFrom)),
    db.select({ id: serviceProduct.id, name: serviceProduct.name }).from(serviceProduct).where(isNull(serviceProduct.deletedAt)).orderBy(asc(serviceProduct.productCode)),
    db.select({ id: branch.id, name: branch.name }).from(branch).where(isNull(branch.deletedAt)).orderBy(asc(branch.name)),
    loadCodes(['CUSTOMER_TYPE']),
  ]);
  return (
    <PricesScreen
      rows={rows}
      products={products.map((p) => ({ value: String(p.id), label: p.name }))}
      branches={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      codes={codes}
      today={new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })}
      {...screenFlags(admin, 'A-PRD-020')}
    />
  );
}
