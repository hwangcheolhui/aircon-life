// A-PRD-010 카테고리 관리 (카테고리 CRUD, 오픈 단계) · F-ADM-PRD-01
import { serviceCategory } from '@aircon/db';
import { asc } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { CategoriesScreen } from './screen';

export default async function CategoriesPage() {
  const admin = await requireScreen('A-PRD-010');
  const [rows, codes] = await Promise.all([
    getDb().select().from(serviceCategory).orderBy(asc(serviceCategory.sortOrder), asc(serviceCategory.code)),
    loadCodes(['SERVICE_PHASE']),
  ]);
  return <CategoriesScreen rows={rows} codes={codes} {...screenFlags(admin, 'A-PRD-010')} />;
}
