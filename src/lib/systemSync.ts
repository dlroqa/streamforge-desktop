import { supabase } from '@/integrations/supabase/client';

// "UPDATE SYSTEM" — an admin-only action that pushes the admin account's shared
// app settings onto every other account. The heavy lifting (and the real
// authorization check) happens in the `sync-system` edge function using the
// service-role key; this is just the browser-side caller.

/** The single account allowed to run UPDATE SYSTEM. Must match the edge
 * function's ADMIN_EMAIL — this constant only controls whether the button is
 * shown; the server is the real gate. */
export const SYSTEM_ADMIN_EMAIL = 'erocaide@gmail.com';

/** Whether the given email may see and use the UPDATE SYSTEM button. */
export function isSystemAdmin(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === SYSTEM_ADMIN_EMAIL;
}

export interface SyncResult {
  /** Accounts whose settings were updated. */
  updated: number;
  /** Other accounts examined (excludes the admin's own). */
  scanned: number;
  /** Accounts that errored during update. */
  failed: number;
  /** The metadata keys that were propagated. */
  keys: string[];
}

/** Run UPDATE SYSTEM: copy this admin's shared settings to all other accounts.
 * Throws with the server's message on failure. */
export async function syncSystem(): Promise<SyncResult> {
  const { data, error } = await supabase.functions.invoke('sync-system', { body: {} });
  if (error) {
    let msg = error.message;
    try {
      const parsed = await (error as { context?: Response }).context?.json();
      if (parsed?.error) msg = parsed.error;
    } catch { /* fall back to generic message */ }
    throw new Error(msg || 'Update failed');
  }
  if (!data?.success) throw new Error(data?.error || 'Update failed');
  return {
    updated: data.updated ?? 0,
    scanned: data.scanned ?? 0,
    failed: data.failed ?? 0,
    keys: Array.isArray(data.keys) ? data.keys : [],
  };
}
