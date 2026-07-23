import { supabase } from '@/integrations/supabase/client';
import { openOAuthPopup } from '@/lib/platformConnect';

// Livepush "Universal Output" — one-click OAuth that links the user's OWN
// Livepush account and returns their per-stream RTMP ingest (server URL + key).
// The studio stores that ingest as an encrypted `livepush` destination and pushes
// its composite there; Livepush fans it out to the 40+ platforms the user linked
// inside Livepush. The OAuth token is only needed to read/toggle those platforms,
// so it lives client-side (localStorage) for fast synchronous access — but it is
// ALSO mirrored to the account (auth user_metadata) so the link follows the user
// across devices/browsers, matching the app's other per-account prefs.

const LS_KEY = 'livepush_connection';
// Key under auth user_metadata where the connection is mirrored for cross-device.
const META_KEY = 'livepush_connection';

export interface LivepushConnection {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms; used to decide when a refresh is due. */
  expiresAt?: number;
  accountId?: string;
  /** Livepush stream id — needed to toggle individual destinations. */
  streamId?: string;
  displayName?: string;
}

/** One fan-out target inside the user's Livepush stream. */
export interface LivepushDestination {
  id: string;
  /** platform id, e.g. "twitch" — drives the icon. */
  appName: string;
  label: string;
  isDisabled: boolean;
}

/** What connectLivepush resolves with — everything the UI needs to add the
 * destination and render the connected state. */
export interface LivepushConnectResult {
  displayName: string;
  streamUrl: string;
  streamKey: string;
  accountId: string;
  streamId: string;
  destinations: LivepushDestination[];
}

export function getStoredLivepushConnection(): LivepushConnection | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as LivepushConnection) : null;
  } catch {
    return null;
  }
}

function storeLivepushConnection(c: LivepushConnection) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* private mode / quota */ }
  // Mirror to the account so the link follows the user to any device. Fire-and-
  // forget: the local copy is authoritative for this session; low frequency
  // (connect / hourly token refresh / one-time streamId discovery).
  void supabase.auth.updateUser({ data: { [META_KEY]: c } }).catch(() => { /* offline / not signed in */ });
}

export function clearStoredLivepushConnection() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  // Also drop it from the account so a disconnect on one device unlinks everywhere.
  void supabase.auth.updateUser({ data: { [META_KEY]: null } }).catch(() => { /* offline / not signed in */ });
}

/**
 * Restore the Livepush connection from the account when this browser has none
 * (e.g. first use on a new computer). Copies the account-level connection saved
 * in user_metadata into localStorage and returns it, or null if there's nothing
 * to restore. Cheap: reads the locally cached session (no network round-trip).
 */
export async function hydrateLivepushConnection(): Promise<LivepushConnection | null> {
  const local = getStoredLivepushConnection();
  if (local?.accessToken) return local;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const meta = session?.user?.user_metadata as Record<string, unknown> | undefined;
    const saved = meta?.[META_KEY];
    if (saved && typeof saved === 'object' && typeof (saved as LivepushConnection).accessToken === 'string'
        && (saved as LivepushConnection).accessToken) {
      const conn = saved as LivepushConnection;
      // Seed localStorage directly (not via storeLivepushConnection) to avoid an
      // immediate, redundant updateUser round-trip writing back what we just read.
      try { localStorage.setItem(LS_KEY, JSON.stringify(conn)); } catch { /* ignore */ }
      return conn;
    }
  } catch { /* ignore */ }
  return null;
}

// Surface the function's own friendly error (which supabase-js otherwise hides
// behind a generic non-2xx). Mirrors invokePC in platformConnect.ts.
async function invokeLP(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('livepush-connect', { body });
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

/** Is our Livepush developer app configured server-side? Controls whether the
 * "Connect Livepush" button is shown. */
export async function getLivepushConfigured(): Promise<boolean> {
  try {
    const data = await invokeLP({ action: 'providers' });
    return !!data.configured;
  } catch {
    return false;
  }
}

/**
 * Full connect flow: authorize-url → consent popup → exchange the code for the
 * user's Livepush ingest + tokens. Must be called from a user gesture (click) so
 * the popup isn't blocked. Persists the token client-side and returns the ingest.
 */
export async function connectLivepush(): Promise<LivepushConnectResult> {
  const redirectUri = `${window.location.origin}/oauth/callback`;
  const state = crypto.randomUUID();

  const auth = await invokeLP({ action: 'authorize-url', redirect_uri: redirectUri, state });
  const code = await openOAuthPopup(auth.url as string, state);

  const r = await invokeLP({ action: 'exchange', code, redirect_uri: redirectUri });
  const lp = (r.livepush ?? {}) as Record<string, unknown>;
  const destinations = parseDestinations(r.destinations);
  const streamId = (lp.stream_id as string) || (r.stream_id as string) || '';

  storeLivepushConnection({
    accessToken: String(lp.access_token ?? ''),
    refreshToken: (lp.refresh_token as string) ?? undefined,
    expiresAt: typeof lp.expires_in === 'number' ? Date.now() + lp.expires_in * 1000 : undefined,
    accountId: (lp.account_id as string) ?? undefined,
    streamId: streamId || undefined,
    displayName: (r.display_name as string) ?? undefined,
  });

  return {
    displayName: (r.display_name as string) || 'Livepush',
    streamUrl: (r.stream_url as string) || '',
    streamKey: (r.stream_key as string) || '',
    accountId: (r.platform_channel_id as string) || '',
    streamId,
    destinations,
  };
}

function parseDestinations(raw: unknown): LivepushDestination[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d): LivepushDestination | null => {
      if (!d || typeof d !== 'object') return null;
      const o = d as Record<string, unknown>;
      const id = typeof o.id === 'string' ? o.id : '';
      if (!id) return null;
      const appName = typeof o.appName === 'string' ? o.appName : '';
      return {
        id,
        appName,
        label: typeof o.label === 'string' && o.label ? o.label : appName || 'Destination',
        isDisabled: o.isDisabled === true,
      };
    })
    .filter((d): d is LivepushDestination => d !== null);
}

/** Refresh the 1h access token in place when it's within ~60s of expiry. Returns
 * the (possibly rotated) access token, or the current one if no refresh is due
 * or possible. Silent on failure — callers fall back to the stored token. */
async function ensureFreshToken(conn: LivepushConnection): Promise<string> {
  const soon = Date.now() + 60_000;
  if (!conn.refreshToken || !conn.expiresAt || conn.expiresAt > soon) {
    return conn.accessToken;
  }
  try {
    const data = await invokeLP({ action: 'refresh', refresh_token: conn.refreshToken });
    const lp = (data.livepush ?? {}) as Record<string, unknown>;
    const accessToken = String(lp.access_token ?? conn.accessToken);
    storeLivepushConnection({
      ...conn,
      accessToken,
      refreshToken: (lp.refresh_token as string) ?? conn.refreshToken,
      expiresAt: typeof lp.expires_in === 'number' ? Date.now() + lp.expires_in * 1000 : conn.expiresAt,
    });
    return accessToken;
  } catch {
    return conn.accessToken;
  }
}

/** Load the account's destinations (id/appName/label/isDisabled) for the UI.
 * Returns [] if Livepush isn't linked or the call fails. */
export async function listLivepushDestinations(): Promise<LivepushDestination[]> {
  const conn = getStoredLivepushConnection();
  if (!conn?.accessToken) return [];
  try {
    const accessToken = await ensureFreshToken(conn);
    const data = await invokeLP({
      action: 'list-destinations',
      access_token: accessToken,
      stream_id: conn.streamId,
    });
    // Persist a stream id discovered server-side if we didn't have one.
    if (typeof data.stream_id === 'string' && data.stream_id && data.stream_id !== conn.streamId) {
      storeLivepushConnection({ ...getStoredLivepushConnection()!, streamId: data.stream_id });
    }
    return parseDestinations(data.destinations);
  } catch {
    return [];
  }
}

/** Enable/disable one destination on the user's Livepush stream. Returns true on
 * success. Throws with a friendly message on failure so the UI can revert. */
export async function setLivepushDestinationEnabled(
  destinationId: string,
  enabled: boolean,
): Promise<boolean> {
  const conn = getStoredLivepushConnection();
  if (!conn?.accessToken || !conn.streamId) {
    throw new Error('Livepush isn\'t fully linked yet — reconnect and try again.');
  }
  const accessToken = await ensureFreshToken(conn);
  await invokeLP({
    action: 'toggle-destination',
    access_token: accessToken,
    stream_id: conn.streamId,
    destination_id: destinationId,
    enable: enabled,
  });
  return true;
}
