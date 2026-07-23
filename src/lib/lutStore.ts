/**
 * Persistent store for uploaded LUTs. The raw color table is binary and can
 * be large (a 65³ LUT is ~800 KB), so IndexedDB — not localStorage — holds
 * the library across sessions. All calls degrade to a no-op / empty result if
 * IndexedDB is unavailable, so the LUT library still works in-session.
 */
import type { ParsedLut } from '@/lib/lut';

const DB_NAME = 'streamforge';
const STORE = 'luts';
const VERSION = 1;

export interface StoredLut extends ParsedLut {
  id: string;
  createdAt: number; // preserves upload order across reloads
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** All saved LUTs, oldest upload first. Empty array if the store is unusable. */
export async function getAllStoredLuts(): Promise<StoredLut[]> {
  try {
    const db = await openDb();
    const rows = await new Promise<StoredLut[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as StoredLut[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function putStoredLut(rec: StoredLut): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* storage unavailable — the LUT still lives in memory this session */
  }
}

export async function deleteStoredLut(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* no-op */
  }
}
