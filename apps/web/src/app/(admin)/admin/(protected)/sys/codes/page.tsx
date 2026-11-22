// A-SYS-040 공통 코드 (코드 그룹·코드 CRUD) · F-ADM-SYS-04
import { commonCode } from '@aircon/db';
import { asc } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { CodesScreen } from './screen';

export default async function CodesPage() {
  const admin = await requireScreen('A-SYS-040');
  const rows = await getDb().select().from(commonCode).orderBy(asc(commonCode.groupCode), asc(commonCode.sortOrder));
  return <CodesScreen rows={rows} {...screenFlags(admin, 'A-SYS-040')} />;
}
