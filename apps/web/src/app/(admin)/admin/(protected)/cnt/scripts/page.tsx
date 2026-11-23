// A-CNT-050 상담 스크립트 (단계 3, F-ADM-CNT-05)
import { consultScript } from '@aircon/db';
import { asc } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { ScriptsScreen } from './screen';

export default async function ScriptsPage() {
  const admin = await requireScreen('A-CNT-050');
  const [rows, codes] = await Promise.all([
    getDb().select().from(consultScript).orderBy(asc(consultScript.triggerPoint), asc(consultScript.scriptCode)),
    loadCodes(['SCRIPT_TRIGGER']),
  ]);
  return <ScriptsScreen rows={rows} codes={codes} {...screenFlags(admin, 'A-CNT-050')} />;
}
