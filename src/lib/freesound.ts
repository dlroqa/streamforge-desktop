import { supabase } from '@/integrations/supabase/client';
import { openOAuthPopup } from '@/lib/platformConnect';

// Freesound.org sound-effects integration for the editor's "Sound Fx" browser.
// OAuth tokens live only in this browser (localStorage); the client secret
// stays in the freesound-auth edge function, which does the code exchange and
// refresh. Search and preview downloads hit the Freesound API directly (it
// sends open CORS headers).

const API = 'https://freesound.org/apiv2';
const LS_KEY = 'freesound.tokens';

export interface FreesoundSound {
  id: number;
  name: string;
  duration: number;
  username: string;
  license: string;
  tags: string[];
  /** Original file format: wav | aiff | ogg | mp3 | m4a | flac. */
  type: string;
  previews: { 'preview-hq-mp3': string; 'preview-lq-mp3': string };
}

// Formats browsers can decode in both <audio> playback and Web Audio export.
// AIFF is excluded on purpose — it only plays in Safari, so those download as
// the HQ MP3 preview instead.
const WEB_PLAYABLE_TYPES = new Set(['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac']);

export interface FreesoundSearchPage {
  results: FreesoundSound[];
  count: number;
  hasMore: boolean;
}

/** Thrown when the Freesound session is gone — the UI should show login again. */
export class FreesoundAuthError extends Error {}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// Invoke the freesound-auth function and surface its friendly error message
// (which supabase-js otherwise hides behind a generic non-2xx). Same pattern
// as invokePC in platformConnect.ts.
async function invokeFS(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('freesound-auth', { body });
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

function saveTokens(data: Record<string, unknown>): Tokens {
  const t: Tokens = {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
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
}

/** Whether the server has Freesound credentials configured. */
export async function isConfigured(): Promise<boolean> {
  try {
    const data = await invokeFS({ action: 'providers' });
    return !!data.configured;
  } catch {
    return false;
  }
}

/**
 * Full login flow: authorize URL → consent popup → code exchange. Must be
 * called from a user gesture (click) so the popup isn't blocked.
 */
export async function login(): Promise<void> {
  const state = crypto.randomUUID();
  const auth = await invokeFS({ action: 'authorize-url', state });
  const code = await openOAuthPopup(auth.url as string, state);
  saveTokens(await invokeFS({ action: 'exchange', code }));
}

async function refreshTokens(refreshToken: string): Promise<string> {
  try {
    const t = saveTokens(await invokeFS({ action: 'refresh', refresh_token: refreshToken }));
    return t.accessToken;
  } catch {
    logout();
    throw new FreesoundAuthError('Your Freesound session expired — please connect again.');
  }
}

async function ensureAccessToken(): Promise<string> {
  const t = getTokens();
  if (!t) throw new FreesoundAuthError('Not connected to Freesound.');
  if (Date.now() < t.expiresAt) return t.accessToken;
  return refreshTokens(t.refreshToken);
}

async function apiFetch(path: string, retry = true): Promise<Response> {
  const token = await ensureAccessToken();
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 && retry) {
    // Token rejected despite a valid-looking expiry (e.g. revoked) — refresh once.
    const t = getTokens();
    if (!t) throw new FreesoundAuthError('Not connected to Freesound.');
    await refreshTokens(t.refreshToken);
    return apiFetch(path, false);
  }
  return res;
}

export async function getMe(): Promise<{ username: string }> {
  const res = await apiFetch('/me/');
  if (!res.ok) throw new Error('Could not read your Freesound profile.');
  const data = await res.json();
  return { username: String(data.username || '') };
}

// Freesound licenses are URLs; show a short human label instead.
function licenseLabel(url: string): string {
  if (/\/zero\/|publicdomain/.test(url)) return 'CC0';
  if (/\/by-nc\//.test(url)) return 'CC BY-NC';
  if (/\/by\//.test(url)) return 'CC BY';
  if (/sampling\+/.test(url)) return 'Sampling+';
  return 'See source';
}

export async function searchSounds(query: string, page = 1): Promise<FreesoundSearchPage> {
  const params = new URLSearchParams({
    query,
    page: String(page),
    page_size: '15',
    fields: 'id,name,previews,duration,username,license,tags,type',
  });
  const res = await apiFetch(`/search/text/?${params.toString()}`);
  if (!res.ok) throw new Error(`Search failed (${res.status}).`);
  const data = await res.json();
  const results: FreesoundSound[] = (data.results ?? []).map((r: FreesoundSound) => ({
    ...r,
    license: licenseLabel(String(r.license || '')),
  }));
  return { results, count: Number(data.count) || results.length, hasMore: data.next != null };
}

/**
 * Download a sound as a File for the Media bin. Uses the original-quality file
 * only when it's a format browsers can decode; AIFF (and anything else) falls
 * back to the HQ MP3 preview so the clip always plays and exports. The preview
 * is also the fallback if the original download's CDN redirect blocks CORS.
 */
export async function downloadSound(sound: FreesoundSound): Promise<File> {
  let blob: Blob | null = null;
  let ext = 'mp3';
  if (sound.type && WEB_PLAYABLE_TYPES.has(sound.type.toLowerCase())) {
    try {
      const res = await apiFetch(`/sounds/${sound.id}/download/`);
      if (res.ok) {
        blob = await res.blob();
        ext = sound.type.toLowerCase();
      }
    } catch (e) {
      if (e instanceof FreesoundAuthError) throw e;
      // Network/CORS failure on the redirect target — use the preview instead.
    }
  }
  if (!blob) {
    const res = await fetch(sound.previews['preview-hq-mp3']);
    if (!res.ok) throw new Error(`Download failed (${res.status}).`);
    blob = await res.blob();
    ext = 'mp3';
  }
  // Strip the original extension from the display name (it may not match the
  // file we actually saved, e.g. an AIFF fetched as MP3).
  const base = sound.name.replace(/\.(wav|aiff?|ogg|mp3|m4a|flac|aac)$/i, '');
  const safe = base.replace(/[^\w\s.-]/g, '').trim().slice(0, 60) || 'sound-fx';
  return new File([blob], `${safe}.${ext}`, { type: blob.type || 'audio/mpeg' });
}
