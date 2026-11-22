import 'server-only';
import { auditLog } from '@aircon/db';
import { headers } from 'next/headers';
import { getDb } from './db';

export type AuditAction = 'VIEW_PII' | 'EXPORT' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'PERMISSION_CHANGE';

/** 감사 로그 기록 (INSERT ONLY, BR-100·02 §7 감사) */
export async function writeAudit(input: {
  actorId: number | null;
  action: AuditAction;
  targetTable?: string;
  targetId?: string | number | null;
  detail?: Record<string, unknown>;
}) {
  const h = await headers();
  await getDb()
    .insert(auditLog)
    .values({
      actorType: 'ADMIN',
      actorId: input.actorId,
      action: input.action,
      targetTable: input.targetTable ?? null,
      targetId: input.targetId == null ? null : String(input.targetId),
      ipAddress: (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '').trim().slice(0, 45) || null,
      userAgent: h.get('user-agent'),
      detailJson: input.detail ?? null,
    });
}
