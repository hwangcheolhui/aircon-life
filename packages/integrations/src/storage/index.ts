/**
 * 첨부파일 저장소 (04 단계 0 공통 기반). Real = Supabase Storage, Mock = 로컬 디스크.
 * STORAGE_DRIVER=supabase|mock
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

export interface StorageAdapter {
  put(key: string, body: Uint8Array, mimeType: string): Promise<void>;
}

export function createLocalStorage(dir: string): StorageAdapter {
  return {
    async put(key, body) {
      const path = join(dir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
  };
}

export function createSupabaseStorage(url: string, serviceRoleKey: string, bucket: string): StorageAdapter {
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return {
    async put(key, body, mimeType) {
      const { error } = await client.storage.from(bucket).upload(key, body, { contentType: mimeType });
      if (error) throw new Error(error.message);
    },
  };
}

export function createStorageAdapter(env: NodeJS.ProcessEnv = process.env): StorageAdapter {
  if (env.STORAGE_DRIVER === 'supabase') {
    return createSupabaseStorage(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', env.SUPABASE_STORAGE_BUCKET ?? 'attachments');
  }
  return createLocalStorage(env.STORAGE_LOCAL_DIR ?? './storage/files');
}
