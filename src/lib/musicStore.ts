// Persistent storage for the Studio music bed. Audio blobs (uploads and fetched
// Suno songs) live in IndexedDB so they survive a reload/logout without bloating
// localStorage; the ordered track list + settings are kept in localStorage and
// reference each blob by an opaque assetId.

const DB_NAME = 'streamforge-studio';
const STORE = 'music';

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

export async function putMusicBlob(blob: Blob): Promise<string> {
  const id = crypto.randomUUID();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return id;
}

async function getMusicBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  return await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as Blob) ?? null);
    req.onerror = () => resolve(null);
  });
}

/** Resolve a stored blob to an object URL, or null if it's gone. */
export async function getMusicBlobUrl(id: string): Promise<string | null> {
  const blob = await getMusicBlob(id);
  return blob ? URL.createObjectURL(blob) : null;
}

export async function deleteMusicBlob(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
