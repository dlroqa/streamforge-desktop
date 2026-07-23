// Persistent storage for the Studio Control Room bank. Graphic blobs (the images
// and videos behind each source button) live in IndexedDB so they survive a
// reload/logout without bloating localStorage; the ordered source list + each
// button's settings are kept in localStorage and reference their blob by an
// opaque assetId. Mirrors the music-bed store (see musicStore.ts).

const DB_NAME = 'streamforge-control-room';
const STORE = 'sources';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Persist a graphic blob under a caller-supplied id (so the source can be added
 * synchronously and its blob written in the background). */
export async function putControlRoomBlob(blob: Blob, id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getControlRoomBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  return await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as Blob) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function deleteControlRoomBlob(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
