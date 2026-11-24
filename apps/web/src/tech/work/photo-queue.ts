'use client';
/**
 * 작업 사진 업로드 대기열 (단계 5-1 기술 과제: 사진 업로드 백그라운드·재시도, 오프라인 임시 저장 후 동기화).
 * - 찍은 사진은 먼저 브라우저(IndexedDB)에 저장하고, 화면과 상관없이 하나씩 서버로 보낸다.
 * - 네트워크 오류면 남겨 두고 다시 연결되거나(online) 15초마다 다시 보낸다. 서버가 거절한 사진(권한·상태)은 오류로 표시하고 다시 보내지 않는다.
 * - IndexedDB 를 못 쓰는 브라우저(사생활 보호 모드 등)는 메모리에만 둔다(새로고침하면 사라짐).
 * - 사진은 긴 변 1600px JPEG 로 줄여 보낸다(Vercel 요청 한도 4.5MB).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface QueuedPhoto {
  id: string;
  orderNo: string;
  photoType: string;
  orderItemId: number | null;
  unitNo: number | null;
  takenAt: string;
  blob: Blob;
  tries: number;
  error?: string;
}

export interface UploadedPhoto {
  id: number;
  photoType: string;
  orderItemId: number | null;
  unitNo: number | null;
  url: string;
}

type Upload = (form: FormData) => Promise<{ ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown }>;

const DB = 'ac-tech';
const STORE = 'photo-queue';
const memory = new Map<string, QueuedPhoto>();

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });
}

async function put(p: QueuedPhoto) {
  memory.set(p.id, p);
  await tx('readwrite', (s) => s.put(p));
}
async function remove(id: string) {
  memory.delete(id);
  await tx('readwrite', (s) => s.delete(id));
}
async function listAll(orderNo: string): Promise<QueuedPhoto[]> {
  const stored = ((await tx('readonly', (s) => s.getAll())) as QueuedPhoto[] | null) ?? [];
  const all = new Map<string, QueuedPhoto>([...stored.map((p) => [p.id, p] as const), ...memory]);
  return [...all.values()].filter((p) => p.orderNo === orderNo).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

/** 아직 서버에 올라가지 않은 사진 수 (완료 화면 확인용) */
export async function countQueued(orderNo: string): Promise<number> {
  return (await listAll(orderNo)).length;
}

/** 긴 변 maxSide px JPEG 로 줄인다. 실패하면 원본 */
export async function compressImage(file: Blob, maxSide = 1600, quality = 0.82): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

/** 화면에서 쓰는 대기열: 사진 추가 → 자동 업로드(재시도) → 올라가면 onUploaded */
export function usePhotoQueue(orderNo: string, upload: Upload, onUploaded: (p: UploadedPhoto) => void) {
  const [items, setItems] = useState<QueuedPhoto[]>([]);
  const [online, setOnline] = useState(true);
  const busy = useRef(false);
  const cb = useRef(onUploaded);
  cb.current = onUploaded;

  const reload = useCallback(async () => setItems(await listAll(orderNo)), [orderNo]);

  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (const p of await listAll(orderNo)) {
        if (p.error) continue;
        if (typeof navigator !== 'undefined' && !navigator.onLine) break;
        const form = new FormData();
        form.set('file', new File([p.blob], `${p.photoType.toLowerCase()}-${p.id}.jpg`, { type: p.blob.type || 'image/jpeg' }));
        form.set('orderNo', p.orderNo);
        form.set('photoType', p.photoType);
        form.set('orderItemId', p.orderItemId === null ? '' : String(p.orderItemId));
        form.set('unitNo', p.unitNo === null ? '' : String(p.unitNo));
        form.set('takenAt', p.takenAt);
        try {
          const r = await upload(form);
          if (r.ok) {
            await remove(p.id);
            cb.current(r.data as UploadedPhoto);
          } else {
            await put({ ...p, tries: p.tries + 1, error: r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '올리지 못했습니다.' });
          }
        } catch {
          // 네트워크 오류: 다음에 다시
          await put({ ...p, tries: p.tries + 1 });
          break;
        }
        await reload();
      }
    } finally {
      busy.current = false;
      await reload();
    }
  }, [orderNo, upload, reload]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      void flush();
    };
    const off = () => setOnline(false);
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    void reload().then(flush);
    const t = window.setInterval(() => void flush(), 15_000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.clearInterval(t);
    };
  }, [flush, reload]);

  const add = useCallback(
    async (file: File, meta: { photoType: string; orderItemId: number | null; unitNo: number | null }) => {
      const blob = await compressImage(file);
      const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      await put({ id, orderNo, ...meta, takenAt: new Date().toISOString(), blob, tries: 0 });
      await reload();
      void flush();
    },
    [orderNo, reload, flush],
  );

  const discard = useCallback(
    async (id: string) => {
      await remove(id);
      await reload();
    },
    [reload],
  );

  const retry = useCallback(
    async (id: string) => {
      const p = items.find((x) => x.id === id);
      if (p) await put({ ...p, error: undefined });
      await reload();
      void flush();
    },
    [items, reload, flush],
  );

  return { items, online, add, discard, retry };
}
