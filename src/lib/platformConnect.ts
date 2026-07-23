import { supabase } from '@/integrations/supabase/client';

export type ConnectPlatform = 'twitch' | 'youtube' | 'facebook';

export interface ProviderMap {
  twitch: boolean;
  youtube: boolean;
  facebook: boolean;
}

export interface ConnectedKey {
  display_name: string;
  stream_url: string;
  stream_key: string;
  platform_channel_id: string;
  // Facebook auto-publish: a long-lived Page token replaces the static key, so
  // going live mints a fresh broadcast that posts to the Page automatically.
  provider_token?: string;
  provider_account_id?: string;
  auto_publish?: boolean;
}

// Invoke the platform-connect function and surface the function's own friendly
// error message (which supabase-js otherwise hides behind a generic non-2xx).
async function invokePC(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('platform-connect', { body });
  if (error) {
    let msg = error.message;
    try {
      // FunctionsHttpError carries the Response in `context`
      const parsed = await (error as { context?: Response }).context?.json();
      if (parsed?.error) msg = parsed.error;
    } catch { /* fall back to generic message */ }
    throw new Error(msg || 'Request failed');
  }
  if (!data?.success) throw new Error(data?.error || 'Request failed');
  return data;
}

/** Which platforms have OAuth configured server-side (creds present). */
export async function getConnectProviders(): Promise<ProviderMap> {
  try {
    const data = await invokePC({ action: 'providers' });
    return (data.providers as ProviderMap) ?? { twitch: false, youtube: false, facebook: false };
  } catch {
    return { twitch: false, youtube: false, facebook: false };
  }
}

/**
 * Full connect flow: get the authorize URL, open the consent popup, then
 * exchange the returned code for the user's stream key + RTMP URL. Must be
 * called from a user gesture (click) so the popup isn't blocked.
 */
export async function connectPlatform(platform: ConnectPlatform): Promise<ConnectedKey> {
  const redirectUri = `${window.location.origin}/oauth/callback`;
  const state = crypto.randomUUID();

  const auth = await invokePC({ action: 'authorize-url', platform, redirect_uri: redirectUri, state });
  const code = await openOAuthPopup(auth.url as string, state);

  const result = await invokePC({ action: 'exchange', platform, code, redirect_uri: redirectUri });
  return result as unknown as ConnectedKey;
}

/** Open the OAuth consent popup and resolve with the returned auth code. */
export function openOAuthPopup(url: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = 600;
    const h = 720;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(url, 'streamforge-oauth', `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) {
      reject(new Error('Popup blocked — allow popups for this site and try again.'));
      return;
    }

    let settled = false;
    // The callback relays the result both via postMessage and a same-origin
    // BroadcastChannel; the channel is what survives providers that sever the
    // opener with Cross-Origin-Opener-Policy (e.g. Freesound).
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('streamforge-oauth') : null;
    let cancelTimer: ReturnType<typeof setInterval> | undefined;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (channel) { channel.onmessage = null; channel.close(); }
      clearTimeout(reliabilityCheck);
      if (cancelTimer) clearInterval(cancelTimer);
    };

    const handle = (d: { source?: string; error?: unknown; state?: unknown; code?: unknown } | null) => {
      if (!d || d.source !== 'streamforge-oauth' || settled) return;
      settled = true;
      cleanup();
      try { popup.close(); } catch { /* already closed / severed */ }
      if (d.error) { reject(new Error(String(d.error))); return; }
      if (d.state !== expectedState) { reject(new Error('Security check failed — please try again.')); return; }
      if (!d.code) { reject(new Error('No authorization was returned.')); return; }
      resolve(d.code as string);
    };

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      handle(e.data);
    };
    window.addEventListener('message', onMessage);
    if (channel) channel.onmessage = (e: MessageEvent) => handle(e.data);

    // Detect a manually-closed popup (user cancelled). A provider whose consent
    // page carries COOP: same-origin severs our handle, making popup.closed read
    // true immediately — which would false-trigger a cancel before the user can
    // authorize. So only poll for a real close if the handle is still open after
    // a grace window; if it already reads closed, the handle is unreliable and we
    // rely solely on the channel relay above.
    const reliabilityCheck = setTimeout(() => {
      if (settled || popup.closed) return;
      cancelTimer = setInterval(() => {
        if (popup.closed && !settled) {
          cleanup();
          reject(new Error('Sign-in was cancelled.'));
        }
      }, 500);
    }, 1000);
  });
}
