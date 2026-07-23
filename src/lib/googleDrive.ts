import { supabase } from '@/integrations/supabase/client';
import { openOAuthPopup } from '@/lib/platformConnect';

// Google Drive integration — lets a user store their own recordings, edited
// videos and graphics in their personal Drive instead of Supabase. OAuth tokens
// live only in this browser (localStorage); the client secret stays in the
// google-drive-auth edge function, which does the code exchange and refresh.
// File up/download hits the Drive REST API directly from the browser (Google
// sends permissive CORS headers for Bearer-authorized requests), so large
// videos never round-trip through our server.
//
// Scope is `drive.file`, so the app only ever sees files it created; everything
// lands in a single "StreamForge" folder in the user's Drive.

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const LS_KEY = 'drive.tokens';
const FOLDER_KEY = 'drive.folderId';
const FOLDER_NAME = 'StreamForge';
// Google recommends resumable uploads above ~5 MB; smaller assets go multipart.
const RESUMABLE_THRESHOLD = 5 * 1024 * 1024;

/** Thrown when the Drive session is gone — the UI should show connect again. */
export class DriveAuthError extends Error {}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// Invoke the google-drive-auth function and surface its friendly error message
// (which supabase-js otherwise hides behind a generic non-2xx). Same pattern as
// invokeFS in freesound.ts / invokePC in platformConnect.ts.
async function invokeGD(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('google-drive-auth', { body });
  if (error) {
    let msg = error.message;
    try {
      const parsed = await (error as { context?: Response }).context?.json();
      if (parsed?.error) msg = parsed.error;
    } catch { /* fall back to generic message */ }
    throw new Error(msg || 'Request failed');
  }
  if (!data?.success) throw new Error(data?.error || 'Request failed');
  return data;
}

export function getTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (typeof t?.accessToken !== 'string' || typeof t?.refreshToken !== 'string') return null;
    return { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Number(t.expiresAt) || 0 };
  } catch {
    return null;
  }
}

// Google returns a refresh_token only on the first exchange; on refresh it's
// absent, so carry the existing one forward.
function saveTokens(data: Record<string, unknown>, fallbackRefresh?: string): Tokens {
  const t: Tokens = {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token || fallbackRefresh || ''),
    // Refresh a minute early so an in-flight request never carries a dead token.
    expiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(t));
  return t;
}

export function isLoggedIn(): boolean {
  return getTokens() !== null;
}

export function logout(): void {
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(FOLDER_KEY);
}

/** Whether the server has Google Drive credentials configured. */
export async function isConfigured(): Promise<boolean> {
  try {
    const data = await invokeGD({ action: 'providers' });
    return !!data.configured;
  } catch {
    return false;
  }
}

/**
 * Full connect flow: authorize URL → consent popup → code exchange. Must be
 * called from a user gesture (click) so the popup isn't blocked.
 */
export async function login(): Promise<void> {
  const redirectUri = `${window.location.origin}/oauth/callback`;
  const state = crypto.randomUUID();
  const auth = await invokeGD({ action: 'authorize-url', redirect_uri: redirectUri, state });
  const code = await openOAuthPopup(auth.url as string, state);
  saveTokens(await invokeGD({ action: 'exchange', code, redirect_uri: redirectUri }));
  // A different account may own a different folder — resolve it fresh.
  localStorage.removeItem(FOLDER_KEY);
}

async function refreshTokens(refreshToken: string): Promise<string> {
  try {
    const t = saveTokens(await invokeGD({ action: 'refresh', refresh_token: refreshToken }), refreshToken);
    return t.accessToken;
  } catch {
    logout();
    throw new DriveAuthError('Your Google Drive session expired — please connect again.');
  }
}

async function ensureAccessToken(): Promise<string> {
  const t = getTokens();
  if (!t) throw new DriveAuthError('Not connected to Google Drive.');
  if (Date.now() < t.expiresAt) return t.accessToken;
  return refreshTokens(t.refreshToken);
}

async function apiFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await ensureAccessToken();
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 && retry) {
    // Token rejected despite a valid-looking expiry (e.g. revoked) — refresh once.
    const t = getTokens();
    if (!t) throw new DriveAuthError('Not connected to Google Drive.');
    await refreshTokens(t.refreshToken);
    return apiFetch(path, init, false);
  }
  return res;
}

/** The connected Google account's email (for the settings UI). */
export async function getMe(): Promise<{ email: string }> {
  const res = await apiFetch('/about?fields=user');
  if (!res.ok) throw new Error('Could not read your Google Drive profile.');
  const data = await res.json();
  return { email: String(data?.user?.emailAddress || '') };
}

let folderPromise: Promise<string> | null = null;

/** Find (or create) the app's "StreamForge" folder and cache its id. */
async function ensureAppFolder(): Promise<string> {
  const cached = localStorage.getItem(FOLDER_KEY);
  if (cached) return cached;
  if (folderPromise) return folderPromise;
  folderPromise = (async () => {
    const q = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const listRes = await apiFetch(`/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`);
    const listData = await listRes.json().catch(() => ({}));
    let id: string | undefined = listData?.files?.[0]?.id;
    if (!id) {
      const createRes = await apiFetch('/files?fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
      });
      const createData = await createRes.json().catch(() => ({}));
      id = createData?.id;
      if (!id) throw new Error('Could not create the StreamForge folder in your Drive.');
    }
    localStorage.setItem(FOLDER_KEY, id);
    return id;
  })();
  try {
    return await folderPromise;
  } finally {
    folderPromise = null;
  }
}

async function multipartUpload(blob: Blob, name: string, parent: string, contentType: string): Promise<string> {
  const token = await ensureAccessToken();
  const boundary = `streamforge-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name, parents: [parent] });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  const res = await fetch(`${UPLOAD_API}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) throw new Error('Upload to Google Drive failed.');
  return data.id as string;
}

async function resumableUpload(blob: Blob, name: string, parent: string, contentType: string): Promise<string> {
  const token = await ensureAccessToken();
  const initRes = await fetch(`${UPLOAD_API}?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': contentType,
      'X-Upload-Content-Length': String(blob.size),
    },
    body: JSON.stringify({ name, parents: [parent] }),
  });
  const sessionUri = initRes.headers.get('Location');
  if (!initRes.ok || !sessionUri) throw new Error('Could not start the Google Drive upload.');
  // The session URI carries its own auth; a single PUT of the whole blob is
  // enough for our file sizes.
  const putRes = await fetch(sessionUri, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob });
  const data = await putRes.json().catch(() => ({}));
  if (!putRes.ok || !data.id) throw new Error('Upload to Google Drive failed.');
  return data.id as string;
}

/** Upload a blob into the StreamForge folder; returns the Drive file id. */
export async function uploadFile(blob: Blob, name: string): Promise<string> {
  const parent = await ensureAppFolder();
  const contentType = blob.type || 'application/octet-stream';
  return blob.size <= RESUMABLE_THRESHOLD
    ? multipartUpload(blob, name, parent, contentType)
    : resumableUpload(blob, name, parent, contentType);
}

const objectUrlCache = new Map<string, string>();

/** Download a file's bytes as a Blob (null if unavailable). */
export async function getFileBlob(fileId: string): Promise<Blob | null> {
  try {
    const res = await apiFetch(`/files/${fileId}?alt=media`);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/** Resolve a file id to a playable object URL, cached for the session. */
export async function getFileObjectUrl(fileId: string): Promise<string | null> {
  const cached = objectUrlCache.get(fileId);
  if (cached) return cached;
  const blob = await getFileBlob(fileId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(fileId, url);
  return url;
}

export async function deleteFile(fileId: string): Promise<void> {
  const cached = objectUrlCache.get(fileId);
  if (cached) { URL.revokeObjectURL(cached); objectUrlCache.delete(fileId); }
  try {
    await apiFetch(`/files/${fileId}`, { method: 'DELETE' });
  } catch { /* best-effort — the metadata row is removed regardless */ }
}
