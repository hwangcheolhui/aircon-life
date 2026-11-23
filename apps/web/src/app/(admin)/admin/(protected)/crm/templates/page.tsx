// A-CRM-040 알림 템플릿·발송 이력 (단계 2: 고객 접수·변경·취소·방문 전날 알림, F-SYS-03). 연락처는 마스킹 저장(notification_log.receiver_phone_masked).
import { notificationLog, notificationTemplate } from '@aircon/db';
import { TEMPLATE_VARIABLES } from '@aircon/domain';
import { asc, desc, eq } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { TemplatesScreen } from './screen';

export default async function TemplatesPage() {
  const admin = await requireScreen('A-CRM-040');
  const db = getDb();
  const [templates, logs, codes] = await Promise.all([
    db.select().from(notificationTemplate).orderBy(asc(notificationTemplate.templateCode)),
    db
      .select({
        id: notificationLog.id,
        templateCode: notificationTemplate.templateCode,
        receiverPhoneMasked: notificationLog.receiverPhoneMasked,
        channel: notificationLog.channel,
        status: notificationLog.status,
        relatedId: notificationLog.relatedId,
        sentAt: notificationLog.sentAt,
        createdAt: notificationLog.createdAt,
        failReason: notificationLog.failReason,
      })
      .from(notificationLog)
      .leftJoin(notificationTemplate, eq(notificationTemplate.id, notificationLog.templateId))
      .orderBy(desc(notificationLog.createdAt))
      .limit(200),
    loadCodes(['NOTIFICATION_CHANNEL', 'NOTIFICATION_TARGET', 'NOTIFICATION_STATUS']),
  ]);
  return (
    <TemplatesScreen
      rows={templates}
      logs={logs}
      codes={codes}
      variables={[...TEMPLATE_VARIABLES]}
      {...screenFlags(admin, 'A-CRM-040')}
    />
  );
}
