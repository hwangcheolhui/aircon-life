/**
 * 첨부파일 저장소 (04 단계 0 공통 기반). Real = Supabase Storage, Mock = 로컬 디스크.
 * STORAGE_DRIVER=supabase|mock
 * 단계 5-1: 작업 사진·고객 서명을 화면에 보여 주기 위해 get(읽기)을 더했다. Supabase 버킷이 아직 없으면 비공개 버킷을 한 번 만들고 다시 올린다.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { createClient } from '@supabase/supabase-js';

export interface StorageAdapter {
  put(key: string, body: Uint8Array, mimeType: string): Promise<void>;
  /** 없으면 null */
  get(key: string): Promise<Uint8Array | null>;
}

export function createLocalStorage(dir: string): StorageAdapter {
  const root = resolve(dir);
  const pathOf = (key: string) => {
    const path = resolve(join(root, key));
    if (!path.startsWith(root + sep)) throw new Error('잘못된 파일 경로입니다.');
    return path;
  };
  return {
    async put(key, body) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathOf(key)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
  };
}

export function createSupabaseStorage(url: string, serviceRoleKey: string, bucket: string): StorageAdapter {
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const upload = (key: string, body: Uint8Array, mimeType: string) =>
    client.storage.from(bucket).upload(key, body, { contentType: mimeType });
  return {
    async put(key, body, mimeType) {
      let { error } = await upload(key, body, mimeType);
      if (error && /bucket not found/i.test(error.message)) {
        // 최초 1회: 비공개 버킷 생성 (파일은 서버를 거쳐서만 내려준다)
        const created = await client.storage.createBucket(bucket, { public: false });
        if (created.error && !/already exists/i.test(created.error.message)) throw new Error(created.error.message);
        ({ error } = await upload(key, body, mimeType));
      }
      if (error) throw new Error(error.message);
    },
    async get(key) {
      const { data, error } = await client.storage.from(bucket).download(key);
      if (error) {
        if (/not found|object not found/i.test(error.message)) return null;
        throw new Error(error.message);
      }
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

export function createStorageAdapter(env: NodeJS.ProcessEnv = process.env): StorageAdapter {
  if (env.STORAGE_DRIVER === 'supabase') {
    return createSupabaseStorage(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', env.SUPABASE_STORAGE_BUCKET ?? 'attachments');
  }
  return createLocalStorage(env.STORAGE_LOCAL_DIR ?? './storage/files');
}
