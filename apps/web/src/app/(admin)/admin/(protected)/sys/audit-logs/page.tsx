// A-SYS-060 감사 로그 · F-ADM-SYS-06, F-ADM-CUS-04: 행위자·행위(개인정보 열람·다운로드·수정·삭제·로그인·권한 변경)·대상·기간 검색. audit_log 는 INSERT ONLY
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { listAuditLogs } from '@/server/purge';
import { AuditLogsScreen } from './screen';

export const dynamic = 'force-dynamic';

const isDate = (v: string | undefined) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireScreen('A-SYS-060');
  const sp = await searchParams;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() + 9 * 3600_000 - 6 * 86_400_000).toISOString().slice(0, 10);
  const q = {
    action: sp.action && /^[A-Z_]+$/.test(sp.action) ? sp.action : null,
    targetTable: sp.table && /^[a-z_]+$/.test(sp.table) ? sp.table : null,
    actorKeyword: sp.actor?.trim().slice(0, 50) || null,
    dateFrom: isDate(sp.from) ? sp.from! : weekAgo,
    dateTo: isDate(sp.to) ? sp.to! : today,
  };
  const [rows, codes] = await Promise.all([listAuditLogs(q), loadCodes(['AUDIT_ACTION', 'ACTOR_TYPE'])]);
  return <AuditLogsScreen rows={rows} query={q} codes={codes} />;
}
