// Persistent storage for editor-uploaded media (audio/images added to the
// timeline) and small editor JSON state (e.g. the Media Bin list). Backed by
// Supabase — blobs go to the private `editor-assets` bucket under the user's
// folder, small JSON records to the `editor_meta` table — so the editor's
// contents follow the user across devices. Asset ids are opaque UUIDs that the
// project JSON references; the storage path is `${userId}/${assetId}`.

import { supabase } from '@/integrations/supabase/client';
import * as drive from '@/lib/googleDrive';
import { isDriveActive, isDriveLocator, driveFileId, driveLocator } from '@/lib/userStorage';

const BUCKET = 'editor-assets';

async function currentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Persist a small JSON value under a key (per user). */
export async function putMeta(key: string, value: unknown): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await supabase
    .from('editor_meta')
    .upsert({ user_id: userId, key, value: value as never } as never, { onConflict: 'user_id,key' });
}

export async function getMeta<T>(key: string): Promise<T | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data } = await supabase
    .from('editor_meta')
    .select('value')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();
  return ((data as { value?: T } | null)?.value ?? null) as T | null;
}

/** Drop a stored meta row (per user). No-op when signed out. */
export async function deleteMeta(key: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await supabase.from('editor_meta').delete().eq('user_id', userId).eq('key', key);
}

/** Upload a blob and return its opaque asset id. `presetId` lets a migration
 * preserve the original id so existing project references still resolve. */
export async function putAsset(blob: Blob, presetId?: string): Promise<string> {
  const userId = await currentUserId();
  if (!userId) throw new Error('Not signed in');
  // Migration replays (presetId set) keep their original id on Supabase so
  // existing project references still resolve; only fresh saves honor the
  // Drive preference and return a `drive:<fileId>` locator instead.
  if (!presetId && await isDriveActive()) {
    const ext = (blob.type.split('/')[1] || 'bin').split(';')[0];
    const fileId = await drive.uploadFile(blob, `asset-${crypto.randomUUID()}.${ext}`);
    return driveLocator(fileId);
  }
  const id = presetId ?? crypto.randomUUID();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${userId}/${id}`, blob, { contentType: blob.type || 'application/octet-stream', upsert: true });
  if (error) throw error;
  return id;
}

const urlCache = new Map<string, string>();

/** Delete a stored asset blob and drop its cached signed URL. */
export async function deleteAsset(id: string): Promise<void> {
  urlCache.delete(id);
  if (isDriveLocator(id)) {
    await drive.deleteFile(driveFileId(id));
    return;
  }
  const userId = await currentUserId();
  if (!userId) return;
  await supabase.storage.from(BUCKET).remove([`${userId}/${id}`]);
}

/** Resolve an asset id to a playable URL (cached for the session). Dispatches
 * on the id: a `drive:<fileId>` locator resolves from Drive, a bare id from the
 * Supabase bucket. */
export async function getAssetUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return cached;
  let url: string | null = null;
  if (isDriveLocator(id)) {
    url = await drive.getFileObjectUrl(driveFileId(id));
  } else {
    const userId = await currentUserId();
    if (!userId) return null;
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(`${userId}/${id}`, 3600);
    url = data?.signedUrl ?? null;
  }
  if (url) urlCache.set(id, url);
  return url;
}
