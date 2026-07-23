import { useEffect } from 'react';

/**
 * OAuth popup landing page. The platform redirects here with ?code&state;
 * we relay them to the window that opened the popup and close. Rendered on a
 * public route so the redirect isn't gated by auth.
 */
export default function OAuthCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message = {
      source: 'streamforge-oauth',
      code: params.get('code'),
      state: params.get('state'),
      error: params.get('error_description') || params.get('error'),
    };
    // Relay over a same-origin BroadcastChannel first: some providers (e.g.
    // Freesound) send Cross-Origin-Opener-Policy: same-origin on the consent
    // page, which severs window.opener — so postMessage alone never arrives.
    // The channel is scoped to our origin and survives that severing.
    try {
      const channel = new BroadcastChannel('streamforge-oauth');
      channel.postMessage(message);
    } catch { /* very old browsers: fall back to postMessage below */ }
    if (window.opener) {
      try { window.opener.postMessage(message, window.location.origin); } catch { /* opener severed */ }
    }
    // Close ourselves — the opener can't reliably close a COOP-severed popup.
    window.close();
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 text-center">
      <p className="text-sm text-muted-foreground">
        Connecting your account… you can close this window.
      </p>
    </div>
  );
}
