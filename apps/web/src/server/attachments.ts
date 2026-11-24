import 'server-only';
import { randomUUID } from 'node:crypto';
import { attachment } from '@aircon/db';
import { createStorageAdapter } from '@aircon/integrations';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import type { Tx } from './orders';

export type Uploader = { type: 'ADMIN' | 'TECHNICIAN' | 'CUSTOMER'; id: number };

/**
 * 첨부파일 저장 (04 단계 0 공통 기반). 파일은 저장소 어댑터, 메타데이터는 attachment 테이블.
 * 단계 5-1: 기사(작업 사진·고객 서명)도 올린다. 파일을 먼저 저장한 뒤 메타데이터를 남긴다(트랜잭션 tx 를 넘기면 그 안에서).
 */
export async function saveAttachment(
  file: Blob & { name?: string },
  refType: string,
  refId: number | null,
  uploader: Uploader | number,
  tx?: Tx,
) {
  const by: Uploader = typeof uploader === 'number' ? { type: 'ADMIN', id: uploader } : uploader;
  const key = `${refType.toLowerCase()}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
  const mimeType = file.type || 'application/octet-stream';
  await createStorageAdapter().put(key, new Uint8Array(await file.arrayBuffer()), mimeType);
  const [row] = await (tx ?? getDb())
    .insert(attachment)
    .values({
      storageKey: key,
      originalName: (file.name || 'file').slice(0, 255),
      mimeType,
      sizeBytes: file.size,
      refType,
      refId,
      uploadedByType: by.type,
      uploadedById: by.id,
    })
    .returning();
  return row!;
}

/** 첨부파일 내용 (권한 확인은 부르는 쪽에서). 지워졌거나 없으면 null */
export async function readAttachment(id: number) {
  const [row] = await getDb().select().from(attachment).where(eq(attachment.id, id));
  if (!row || row.deletedAt) return null;
  const body = await createStorageAdapter().get(row.storageKey);
  return body ? { row, body } : null;
}
