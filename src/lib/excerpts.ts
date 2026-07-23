// "Excerpts" — edited videos exported from the Video Editor and saved into the
// Studio's Media Library. Stored server-side (Supabase: an `excerpts` table for
// metadata + an `excerpts` storage bucket for the video blob, keyed to the
// signed-in user) so they follow the user across devices. A BroadcastChannel
// still notifies other windows on the SAME machine to refresh instantly; other
// devices pick changes up on their next load.

import { supabase } from '@/integrations/supabase/client';
import * as drive from '@/lib/googleDrive';
import { isDriveActive, isDriveLocator, driveFileId, driveLocator } from '@/lib/userStorage';

const CHANNEL = 'streamforge-excerpts';
const BUCKET = 'excerpts';

export interface ExcerptMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  createdAt: number;
  /** Storage object path (`${userId}/${id}.ext`). */
  storage_path: string;
}

interface ExcerptRow {
  id: string;
  name: string;
  mime: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  storage_path: string;
  created_at: string;
}

function rowToMeta(r: ExcerptRow): ExcerptMeta {
  return {
    id: r.id,
    name: r.name,
    mime: r.mime,
    size: r.size,
    duration: r.duration,
    width: r.width,
    height: r.height,
    createdAt: new Date(r.created_at).getTime(),
    storage_path: r.storage_path,
  };
}

function extFor(mime: string): string {
  return mime.includes('mp4') ? 'mp4' : 'webm';
}

function notify() {
  try { new BroadcastChannel(CHANNEL).postMessage('changed'); } catch { /* unsupported */ }
}

/** Subscribe to excerpt add/remove events (from any window). Returns unsub. */
export function onExcerptsChanged(cb: () => void): () => void {
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = () => cb();
  } catch { /* unsupported — caller can still reload manually */ }
  return () => { try { ch?.close(); } catch { /* noop */ } };
}

export async function saveExcerpt(
  blob: Blob,
  info: { name: string; duration: number; width: number; height: number },
): Promise<ExcerptMeta | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const id = crypto.randomUUID();
  const mime = blob.type || 'video/webm';
  const name = (info.name || 'Excerpt').slice(0, 80);

  // The stored blob's backend is encoded in `storage_path`: a `drive:<fileId>`
  // locator for the user's Google Drive, or a Supabase object path otherwise.
  let storage_path: string;
  if (await isDriveActive()) {
    try {
      const safe = name.replace(/[^\w\s-]/g, '').trim() || 'excerpt';
      const fileId = await drive.uploadFile(blob, `${safe}.${extFor(mime)}`);
      storage_path = driveLocator(fileId);
    } catch (e) {
      if (import.meta.env.DEV) console.error('Excerpt Drive upload failed:', e);
      return null;
    }
  } else {
    storage_path = `${user.id}/${id}.${extFor(mime)}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storage_path, blob, { contentType: mime });
    if (upErr) {
      if (import.meta.env.DEV) console.error('Excerpt upload failed:', upErr);
      return null;
    }
  }

  const row = {
    id,
    user_id: user.id,
    name,
    mime,
    size: blob.size,
    duration: info.duration,
    width: info.width,
    height: info.height,
    storage_path,
  };
  const { error: insErr } = await supabase.from('excerpts').insert(row as never);
  if (insErr) {
    // Roll back the orphaned blob so we don't leak storage.
    if (isDriveLocator(storage_path)) await drive.deleteFile(driveFileId(storage_path));
    else await supabase.storage.from(BUCKET).remove([storage_path]);
    if (import.meta.env.DEV) console.error('Excerpt insert failed:', insErr);
    return null;
  }

  notify();
  return {
    id, name, mime, size: blob.size, duration: info.duration,
    width: info.width, height: info.height, createdAt: Date.now(), storage_path,
  };
}

export async function listExcerpts(): Promise<ExcerptMeta[]> {
  const { data, error } = await supabase
    .from('excerpts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as unknown as ExcerptRow[]).map(rowToMeta);
}

async function pathForId(id: string): Promise<string | null> {
  const { data } = await supabase.from('excerpts').select('storage_path').eq('id', id).maybeSingle();
  return (data as { storage_path?: string } | null)?.storage_path ?? null;
}

export async function getExcerptUrl(id: string): Promise<string | null> {
  const path = await pathForId(id);
  if (!path) return null;
  if (isDriveLocator(path)) return drive.getFileObjectUrl(driveFileId(path));
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/** The excerpt as a File (for cloud upload / playback), or null if unavailable. */
export async function getExcerptFile(meta: ExcerptMeta): Promise<File | null> {
  let blob: Blob | null = null;
  if (isDriveLocator(meta.storage_path)) {
    blob = await drive.getFileBlob(driveFileId(meta.storage_path));
  } else {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(meta.storage_path, 3600);
    if (!data?.signedUrl) return null;
    try {
      const res = await fetch(data.signedUrl);
      if (!res.ok) return null;
      blob = await res.blob();
    } catch {
      return null;
    }
  }
  if (!blob) return null;
  const safe = meta.name.replace(/[^\w\s-]/g, '').trim() || 'excerpt';
  return new File([blob], `${safe}.${extFor(meta.mime)}`, { type: meta.mime });
}

export async function renameExcerpt(id: string, name: string): Promise<void> {
  const clean = (name || '').trim().slice(0, 80);
  if (!clean) return;
  await supabase.from('excerpts').update({ name: clean } as never).eq('id', id);
  notify();
}

export async function deleteExcerpt(id: string): Promise<void> {
  const path = await pathForId(id);
  if (path) {
    if (isDriveLocator(path)) await drive.deleteFile(driveFileId(path));
    else await supabase.storage.from(BUCKET).remove([path]);
  }
  await supabase.from('excerpts').delete().eq('id', id);
  notify();
}
