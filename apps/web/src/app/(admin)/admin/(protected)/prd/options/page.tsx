// A-PRD-040 옵션·자재 마스터 (옵션 상품, 자재 원가·판매가) · F-ADM-PRD-04
import { material, serviceOption, serviceProduct } from '@aircon/db';
import { asc, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { OptionsScreen } from './screen';

export default async function OptionsPage() {
  const admin = await requireScreen('A-PRD-040');
  const db = getDb();
  const [options, materials, products, codes] = await Promise.all([
    db.select().from(serviceOption).orderBy(asc(serviceOption.optionCode)),
    db.select().from(material).orderBy(asc(material.materialCode)),
    db.select({ id: serviceProduct.id, name: serviceProduct.name }).from(serviceProduct).where(isNull(serviceProduct.deletedAt)),
    loadCodes(['MATERIAL_UNIT']),
  ]);
  return (
    <OptionsScreen
      options={options}
      materials={materials}
      products={products.map((p) => ({ value: String(p.id), label: p.name }))}
      codes={codes}
      {...screenFlags(admin, 'A-PRD-040')}
    />
  );
}
