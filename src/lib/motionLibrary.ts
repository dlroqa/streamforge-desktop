/**
 * Shared library of generated motion graphics. Every successful render — from
 * the Studio panel or the Video Editor sheet — is saved here so it can be
 * reused later without re-rendering. Blobs live in the `editor-assets` bucket
 * and the item list in `editor_meta` (both per-user via editorAssets), so the
 * library follows the user across devices and both surfaces see one list.
 */

import { putAsset, getAssetUrl, deleteAsset, getMeta, putMeta } from '@/lib/editorAssets';
import type { MotionFormat, MotionMode } from '@/lib/hyperframes';

const META_KEY = 'motion-library';

/** Fixed capacity: saving beyond this evicts the oldest render (blob + entry). */
export const MOTION_LIBRARY_SLOTS = 12;

export interface MotionLibraryItem {
  /** Also the asset id of the stored video blob. */
  id: string;
  prompt: string;
  mode: MotionMode;
  template?: string;
  format: MotionFormat;
  width: number;
  height: number;
  duration: number;
  createdAt: number;
}

export async function listMotionLibrary(): Promise<MotionLibraryItem[]> {
  return (await getMeta<MotionLibraryItem[]>(META_KEY)) ?? [];
}

/** Store a fresh render and prepend it to the library list. When the library
 * is at capacity the oldest renders are evicted to make room. */
export async function saveMotionGraphic(
  file: File,
  meta: Omit<MotionLibraryItem, 'id' | 'createdAt'>,
): Promise<{ item: MotionLibraryItem; list: MotionLibraryItem[]; evicted: number }> {
  const id = await putAsset(file);
  const item: MotionLibraryItem = { ...meta, id, createdAt: Date.now() };
  const next = [item, ...(await listMotionLibrary())];
  const evicted = next.splice(MOTION_LIBRARY_SLOTS);
  await putMeta(META_KEY, next);
  // Best-effort blob cleanup — the list entry is already gone either way.
  for (const e of evicted) await deleteAsset(e.id).catch(() => {});
  return { item, list: next, evicted: evicted.length };
}

/** Remove an item: drop its blob and its list entry. */
export async function deleteMotionGraphic(id: string): Promise<void> {
  const list = await listMotionLibrary();
  await putMeta(META_KEY, list.filter(i => i.id !== id));
  await deleteAsset(id);
}

/** Signed playback URL for an item's video (session-cached by editorAssets). */
export function getMotionUrl(id: string): Promise<string | null> {
  return getAssetUrl(id);
}

/** Re-materialize a library item as a File, so the same host actions that
 * consume fresh renders (overlay / media bin / download) work on saved ones. */
export async function getMotionFile(item: MotionLibraryItem): Promise<File> {
  const url = await getMotionUrl(item.id);
  if (!url) throw new Error('Not signed in — the library needs your account.');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not fetch the saved video.');
  const blob = await res.blob();
  const base = item.prompt.split(/\r?\n|\|/)[0].trim().slice(0, 40).replace(/[^\w -]+/g, '').trim() || 'motion-graphic';
  return new File([blob], `${base}.${item.format}`, {
    type: item.format === 'mp4' ? 'video/mp4' : 'video/webm',
  });
}
