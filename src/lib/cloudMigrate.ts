// One-time backfill: lift any media that was created on this device BEFORE the
// cloud-sync switchover (legacy IndexedDB / localStorage) up to the user's
// Supabase account, so their existing excerpts and editor project appear on
// every device. Idempotent per device via localStorage flags; every step is
// best-effort and never throws into the caller.

import { supabase } from '@/integrations/supabase/client';
import { saveExcerpt } from '@/lib/excerpts';
import { putAsset, putMeta } from '@/lib/editorAssets';

const EXCERPTS_FLAG = 'sf-cloud-migrated-excerpts-v1';
const EDITOR_FLAG = 'sf-cloud-migrated-editor-v1';

// ── Legacy IndexedDB access (open existing DBs read-only, no schema changes) ──
function openLegacy(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(name); } catch { resolve(null); return; }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // If the DB didn't exist it's created empty here; reads just return nothing.
    req.onupgradeneeded = () => { /* leave empty */ };
  });
}

function hasStore(db: IDBDatabase, store: string): boolean {
  return db.objectStoreNames.contains(store);
}

function getAllEntries(db: IDBDatabase, store: string): Promise<{ key: IDBValidKey; value: unknown }[]> {
  return new Promise((resolve) => {
    if (!hasStore(db, store)) { resolve([]); return; }
    const out: { key: IDBValidKey; value: unknown }[] = [];
    try {
      const tx = db.transaction(store, 'readonly');
      const cur = tx.objectStore(store).openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (c) { out.push({ key: c.key, value: c.value }); c.continue(); }
        else resolve(out);
      };
      cur.onerror = () => resolve(out);
    } catch { resolve(out); }
  });
}

function getOne(db: IDBDatabase, store: string, key: string): Promise<unknown> {
  return new Promise((resolve) => {
    if (!hasStore(db, store)) { resolve(null); return; }
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

interface LegacyExcerptMeta {
  id: string; name: string; mime: string; size: number;
  duration: number; width: number; height: number; createdAt: number;
}

async function migrateExcerpts(): Promise<void> {
  if (localStorage.getItem(EXCERPTS_FLAG)) return;
  const db = await openLegacy('streamforge-excerpts');
  if (!db) { localStorage.setItem(EXCERPTS_FLAG, '1'); return; }
  try {
    const metas = await getAllEntries(db, 'meta');
    for (const { value } of metas) {
      const m = value as LegacyExcerptMeta;
      const blob = await getOne(db, 'blobs', m.id) as Blob | null;
      if (!blob) continue;
      await saveExcerpt(blob, {
        name: m.name, duration: m.duration, width: m.width, height: m.height,
      });
    }
  } catch (e) {
    if (import.meta.env.DEV) console.error('Excerpt migration failed:', e);
  } finally {
    db.close();
    localStorage.setItem(EXCERPTS_FLAG, '1');
  }
}

async function migrateEditor(userId: string): Promise<void> {
  if (localStorage.getItem(EDITOR_FLAG)) return;
  try {
    const db = await openLegacy('streamforge-editor');
    // Upload every stored asset blob, preserving its id so project/media-bin
    // references keep resolving.
    if (db) {
      const assets = await getAllEntries(db, 'assets');
      for (const { key, value } of assets) {
        if (typeof key === 'string' && value instanceof Blob) {
          try { await putAsset(value, key); } catch { /* skip one bad asset */ }
        }
      }
      // Media Bin list (small JSON) moves to the editor_meta table.
      const bin = await getOne(db, 'meta', 'stock-bin');
      if (bin) await putMeta('stock-bin', bin);
      db.close();
    }

    // Only seed the cloud project if the account doesn't already have one
    // (another device may have synced first — don't clobber it).
    const { data: existing } = await supabase
      .from('editor_projects').select('user_id').eq('user_id', userId).maybeSingle();
    if (!existing) {
      const raw = localStorage.getItem('streamforge-editor-project');
      if (raw) {
        try {
          const project = JSON.parse(raw);
          if (project?.version === 1 && Array.isArray(project.clips)) {
            await supabase.from('editor_projects').upsert(
              { user_id: userId, project: project as never } as never,
              { onConflict: 'user_id' },
            );
          }
        } catch { /* malformed local project — skip */ }
      }
    }
  } catch (e) {
    if (import.meta.env.DEV) console.error('Editor migration failed:', e);
  } finally {
    localStorage.setItem(EDITOR_FLAG, '1');
  }
}

let running = false;

/** Run the one-time local→cloud backfill for the signed-in user. Safe to call
 * on every sign-in / app load; guarded by per-device flags and an in-flight lock. */
export async function runCloudMigration(): Promise<void> {
  if (running) return;
  if (localStorage.getItem(EXCERPTS_FLAG) && localStorage.getItem(EDITOR_FLAG)) return;
  running = true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await migrateExcerpts();
    await migrateEditor(user.id);
  } finally {
    running = false;
  }
}
