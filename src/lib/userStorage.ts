import { supabase } from '@/integrations/supabase/client';
import * as drive from '@/lib/googleDrive';

// Storage routing for user files. A user can opt to store their new files in
// their own Google Drive instead of Supabase (per-account preference in auth
// user_metadata). Existing Supabase files always keep resolving: the backend of
// a stored blob is encoded in its locator string — a `drive:<fileId>` prefix
// means Drive, anything else is a legacy Supabase path/id.

export type StorageBackend = 'supabase' | 'drive';

const DRIVE_PREFIX = 'drive:';

export function driveLocator(fileId: string): string {
  return DRIVE_PREFIX + fileId;
}

export function isDriveLocator(locator: string | null | undefined): boolean {
  return typeof locator === 'string' && locator.startsWith(DRIVE_PREFIX);
}

export function driveFileId(locator: string): string {
  return locator.slice(DRIVE_PREFIX.length);
}

/** The account's stored storage-backend preference (defaults to 'supabase'). */
export function storageBackendOf(meta: { storage_backend?: unknown } | null | undefined): StorageBackend {
  return meta?.storage_backend === 'drive' ? 'drive' : 'supabase';
}

/**
 * Whether NEW uploads for the signed-in user should go to Google Drive: the
 * preference is set to Drive AND a Drive session is connected in this browser.
 * Falls back to Supabase otherwise, so a set-but-disconnected preference never
 * blocks saving.
 */
export async function isDriveActive(): Promise<boolean> {
  if (!drive.isLoggedIn()) return false;
  // getSession() reads the locally cached session (no network); user_metadata
  // there stays fresh via the USER_UPDATED auth event.
  const { data: { session } } = await supabase.auth.getSession();
  return storageBackendOf(session?.user?.user_metadata as { storage_backend?: unknown } | undefined) === 'drive';
}
