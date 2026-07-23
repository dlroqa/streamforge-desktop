/**
 * Local-recording persistence helpers.
 *
 * Browsers can't link to arbitrary paths on disk, so "click to open" for
 * local files works via three layers:
 * 1. File System Access API (Chromium): the save dialog's file handle is
 *    persisted in IndexedDB, letting the library reopen the exact file later
 *    (with a one-click permission prompt).
 * 2. Session blob cache: recordings made this session play instantly even
 *    without a handle.
 * 3. Fallback (Firefox/Safari or picker refusal): classic auto-download; the
 *    library shows the filename to find in the Downloads folder.
 */

// Chromium-only APIs not present in lib.dom
interface FSFileHandle extends FileSystemFileHandle {
  queryPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

declare global {
  interface Window {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<FSFileHandle>;
  }
}

// ── Session blob cache ──
const blobCache = new Map<string, Blob>();

export function cacheLocalBlob(recordingId: string, blob: Blob) {
  blobCache.set(recordingId, blob);
}

export function dropLocalBlob(recordingId: string) {
  blobCache.delete(recordingId);
}

// ── IndexedDB handle store ──
const DB_NAME = 'streamforge-local-recordings';
const STORE = 'handles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteLocalHandle(recordingId: string): Promise<void> {
  dropLocalBlob(recordingId);
  try { await idbDelete(recordingId); } catch { /* nothing persisted */ }
}

// ── Saving ──

export interface LocalSaveResult {
  fileName: string;
  /** True when saved via the picker (handle persisted → reopenable later) */
  viaPicker: boolean;
  handle: FSFileHandle | null;
}

function anchorDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Save via the File System Access picker when available; otherwise (or on
 * any failure, including the user cancelling the picker) fall back to a
 * classic download so the recording is never lost. */
export async function saveLocalRecording(blob: Blob, suggestedName: string): Promise<LocalSaveResult> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'WebM video', accept: { 'video/webm': ['.webm'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { fileName: handle.name, viaPicker: true, handle };
    } catch {
      // Cancelled or unsupported mid-flight — never lose the recording
    }
  }
  anchorDownload(blob, suggestedName);
  return { fileName: suggestedName, viaPicker: false, handle: null };
}

export async function persistLocalHandle(recordingId: string, handle: FSFileHandle): Promise<void> {
  try { await idbPut(recordingId, handle); } catch { /* handle not cloneable → session cache still works */ }
}

// ── Opening ──

export type OpenLocalResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'no-handle' | 'denied' | 'missing-file' };

/** Resolve a playable object URL for a local recording: session cache first,
 * then the persisted file handle (asking permission if needed). */
export async function openLocalRecording(recordingId: string): Promise<OpenLocalResult> {
  const cached = blobCache.get(recordingId);
  if (cached) return { ok: true, url: URL.createObjectURL(cached) };

  let handle: FSFileHandle | undefined;
  try { handle = await idbGet<FSFileHandle>(recordingId); } catch { /* no store */ }
  if (!handle) return { ok: false, reason: 'no-handle' };

  try {
    let permission = await handle.queryPermission?.({ mode: 'read' }) ?? 'granted';
    if (permission !== 'granted') {
      permission = await handle.requestPermission?.({ mode: 'read' }) ?? 'denied';
    }
    if (permission !== 'granted') return { ok: false, reason: 'denied' };

    const file = await handle.getFile();
    return { ok: true, url: URL.createObjectURL(file) };
  } catch {
    // File moved/deleted since it was saved
    return { ok: false, reason: 'missing-file' };
  }
}
