// A-CNT-030 기술자료·SOP · F-ADM-CNT-03: 유형·기기(비우면 공통)·제목·내용·첨부(PDF·사진 최대 3개)·필독, 버전(제목·내용·첨부가 바뀌면 +1)
// 기사 앱 T-EDU-010 에 노출. 첨부는 비공개 저장소(/api/files/{id})
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { listTechDocs } from '@/server/tech-docs';
import { TechDocsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function TechDocsAdminPage() {
  const admin = await requireScreen('A-CNT-030');
  const [rows, codes] = await Promise.all([listTechDocs(), loadCodes(['TECH_DOC_TYPE', 'DEVICE_TYPE'])]);
  const flags = screenFlags(admin, 'A-CNT-030');
  const live = !admin.preview;
  return (
    <TechDocsScreen
      rows={rows.map((d) => ({
        id: d.id,
        docType: d.docType,
        deviceType: d.deviceType,
        title: d.title,
        content: d.content,
        isRequiredRead: d.isRequiredRead,
        version: d.version,
        fileCount: d.fileCount,
        updatedAt: d.updatedAt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
      }))}
      codes={codes}
      canCreate={live && flags.canCreate}
      canUpdate={live && flags.canUpdate}
      canDelete={live && flags.canDelete}
    />
  );
}
