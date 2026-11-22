import 'server-only';
import { randomUUID } from 'node:crypto';
import { attachment } from '@aircon/db';
import { createStorageAdapter } from '@aircon/integrations';
import { getDb } from './db';

/** 첨부파일 저장 (04 단계 0 공통 기반). 파일은 저장소 어댑터, 메타데이터는 attachment 테이블 */
export async function saveAttachment(file: File, refType: string, refId: number | null, uploadedById: number) {
  const key = `${refType.toLowerCase()}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
  await createStorageAdapter().put(key, new Uint8Array(await file.arrayBuffer()), file.type || 'application/octet-stream');
  const [row] = await getDb()
    .insert(attachment)
    .values({
      storageKey: key,
      originalName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      refType,
      refId,
      uploadedByType: 'ADMIN',
      uploadedById,
    })
    .returning();
  return row!;
}
