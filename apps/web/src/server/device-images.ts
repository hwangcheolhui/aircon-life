import 'server-only';
/**
 * C-QUO-021 사진으로 기기 인식 (단계 9, F-CUS-QUO-05, 01 §2.4.3 device_image).
 * 비회원 견적 중에 올리므로 처음엔 quote_id 없이 저장하고, 견적을 발행하면 연결한다(linkImagesToQuote).
 * 인식은 이미지 인식 어댑터(VISION_DRIVER, 지금은 Mock). 결과는 참고값이고 고객이 확인·수정한 형태(confirmed_type)로 견적한다.
 * 사진 파일은 attachment(ref_type=DEVICE_IMAGE)에 두고 고객 화면에는 다시 내려주지 않는다(브라우저 미리보기만).
 */
import { attachment, deviceImage } from '@aircon/db';
import { RECOGNITION_CONFIDENT } from '@aircon/domain';
import { createDeviceRecognizer } from '@aircon/integrations';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { UserError } from './action-result';
import { saveAttachment } from './attachments';
import { getDb } from './db';

export const DEVICE_IMAGE_MAX = 5;
const MAX_BYTES = 4 * 1024 * 1024;

export async function recognizeDevicePhotos(files: File[], customerId: number | null) {
  if (!files.length) throw new UserError('기기 사진을 올려 주세요.');
  if (files.length > DEVICE_IMAGE_MAX) throw new UserError(`사진은 ${DEVICE_IMAGE_MAX}장까지 올릴 수 있어요.`);
  for (const f of files) {
    if (!f.type.startsWith('image/')) throw new UserError('사진 파일만 올릴 수 있어요.');
    if (f.size > MAX_BYTES) throw new UserError('사진은 한 장에 4MB 이하로 올려 주세요.');
  }
  const recognizer = createDeviceRecognizer();
  const db = getDb();
  const out: { imageId: number; deviceType: string | null; brand: string | null; dirtLevel: string | null; confidence: number; confident: boolean }[] = [];
  for (const f of files) {
    const r = await recognizer.recognize({ fileName: f.name, size: f.size, contentType: f.type });
    const id = await db.transaction(async (tx) => {
      const file = await saveAttachment(f, 'DEVICE_IMAGE', null, { type: 'CUSTOMER', id: customerId ?? 0 }, tx);
      const [row] = await tx
        .insert(deviceImage)
        .values({
          fileId: file.id,
          purpose: 'DEVICE_TYPE',
          recognizedType: r.deviceType,
          recognizedBrand: r.brand,
          dirtLevel: r.dirtLevel,
          confidence: r.confidence.toFixed(3),
          createdBy: customerId,
          updatedBy: customerId,
        })
        .returning({ id: deviceImage.id });
      await tx.update(attachment).set({ refId: row!.id }).where(eq(attachment.id, file.id));
      return row!.id;
    });
    out.push({ imageId: id, deviceType: r.deviceType, brand: r.brand, dirtLevel: r.dirtLevel, confidence: r.confidence, confident: r.confidence >= RECOGNITION_CONFIDENT });
  }
  return out;
}

/** 고객이 확인·수정한 형태 저장 (아직 견적에 연결되지 않은 이미지만) */
export async function confirmRecognition(items: { imageId: number; deviceType: string }[]) {
  const db = getDb();
  for (const it of items) {
    const [img] = await db.select().from(deviceImage).where(and(eq(deviceImage.id, it.imageId), isNull(deviceImage.quoteId)));
    if (!img) continue;
    await db
      .update(deviceImage)
      .set({ userConfirmed: img.recognizedType === it.deviceType, confirmedType: it.deviceType, updatedAt: new Date() })
      .where(eq(deviceImage.id, it.imageId));
  }
}

/** 견적 발행 후 사진 연결 (이미 다른 견적에 연결된 이미지는 건드리지 않는다) */
export async function linkImagesToQuote(quoteId: number, imageIds: number[]) {
  if (!imageIds.length) return;
  await getDb()
    .update(deviceImage)
    .set({ quoteId, updatedAt: new Date() })
    .where(and(inArray(deviceImage.id, imageIds), isNull(deviceImage.quoteId)));
}
