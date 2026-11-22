// A-PRD-030 할증·추가요금 규칙 (조건·금액·안내 문구) · F-ADM-PRD-03
import { surchargeRule } from '@aircon/db';
import { asc } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { SurchargesScreen } from './screen';

export default async function SurchargesPage() {
  const admin = await requireScreen('A-PRD-030');
  const [rows, codes] = await Promise.all([
    getDb().select().from(surchargeRule).orderBy(asc(surchargeRule.ruleCode)),
    loadCodes(['SURCHARGE_RULE', 'SURCHARGE_APPLY_TYPE', 'AMOUNT_TYPE']),
  ]);
  return <SurchargesScreen rows={rows} codes={codes} {...screenFlags(admin, 'A-PRD-030')} />;
}
