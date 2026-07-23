/**
 * "Suno": load music you made on Suno into the editor as audio clips.
 *
 * Suno has no public API or third-party OAuth, so this deliberately does NOT
 * log in. It works from PUBLIC links you already have:
 *   - /song/{uuid}      resolved entirely in the browser (the CDN mp3 sends
 *                       Access-Control-Allow-Origin: *), so no backend needed.
 *   - /s/{code}         a short share link that redirects to a song; the
 *   - /playlist/{uuid}  playlist page embeds its clip list.
 * The last two can't be read cross-origin from the browser, so they're resolved
 * by the video-cut-resolver's /suno endpoint (public-page scrape, no login),
 * which returns track metadata; the browser then fetches each CDN mp3 itself.
 *
 * Only load music you have the rights to.
 */

/** Resolver base (same env var Video Cut uses). '' when unset. */
const RESOLVER_BASE = ((import.meta.env.VITE_VIDEO_CUT_ENDPOINT as string | undefined) || '').replace(/\/$/, '');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SONG_RE = new RegExp(`(?:suno\\.com|app\\.suno\\.ai)/song/(${UUID})`, 'i');
const SHORT_RE = /(?:suno\.com|app\.suno\.ai)\/s\/[A-Za-z0-9]+/i;
// Playlists are usually /playlist/{uuid}, but named views (e.g. /playlist/liked)
// exist too — accept any slug so the resolver can try and return a clear error.
const PLAYLIST_RE = /(?:suno\.com|app\.suno\.ai)\/playlist\/[A-Za-z0-9-]+/i;
const BARE_UUID_RE = new RegExp(`^(${UUID})$`, 'i');

export type SunoUrlKind = 'song' | 'short' | 'playlist' | 'invalid';

/** One resolved Suno song: enough to fetch and name it. */
export interface SunoTrack {
  id: string;
  title: string;
  audioUrl: string;
}

export interface SunoResolveResult {
  type: 'song' | 'playlist';
  name: string;
  tracks: SunoTrack[];
}

export function classifySunoUrl(raw: string): SunoUrlKind {
  const t = raw.trim();
  if (!t) return 'invalid';
  if (SONG_RE.test(t) || BARE_UUID_RE.test(t)) return 'song';
  if (SHORT_RE.test(t)) return 'short';
  if (PLAYLIST_RE.test(t)) return 'playlist';
  return 'invalid';
}

function sunoSongId(raw: string): string | null {
  const t = raw.trim();
  return t.match(SONG_RE)?.[1] ?? t.match(BARE_UUID_RE)?.[1] ?? null;
}

export function sunoMp3Url(uuid: string): string {
  return `https://cdn1.suno.ai/${uuid}.mp3`;
}

/** Ask the resolver to turn a short or playlist link into track metadata. */
async function resolveViaBackend(url: string, signal?: AbortSignal): Promise<SunoResolveResult> {
  if (!RESOLVER_BASE) {
    throw new Error(
      'That link needs the Suno resolver, which isn’t configured. Paste a full song ' +
      'link (https://suno.com/song/…) instead.',
    );
  }
  let res: Response;
  try {
    res = await fetch(`${RESOLVER_BASE}/suno`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal,
    });
  } catch {
    throw new Error('Could not reach the Suno resolver. Try again in a moment.');
  }
  const data = await res.json().catch(() => ({})) as Partial<SunoResolveResult> & { error?: string };
  if (!res.ok || data.error) throw new Error(data.error || `Resolver failed (${res.status}).`);
  if (!data.tracks?.length) throw new Error('No songs found at that link.');
  return { type: data.type ?? 'playlist', name: data.name ?? 'Suno', tracks: data.tracks };
}

/** Resolve any supported Suno link to its list of tracks (metadata only). */
export async function resolveSunoTracks(raw: string, opts: { signal?: AbortSignal } = {}): Promise<SunoResolveResult> {
  const kind = classifySunoUrl(raw);
  if (kind === 'invalid') {
    throw new Error('Paste a Suno song, share, or playlist link, e.g. https://suno.com/song/…');
  }
  if (kind === 'song') {
    const uuid = sunoSongId(raw)!;
    // Fully client-side — works even if the resolver is down.
    return { type: 'song', name: 'Suno song', tracks: [{ id: uuid, title: 'Suno song', audioUrl: sunoMp3Url(uuid) }] };
  }
  return resolveViaBackend(raw.trim(), opts.signal);
}

/** Fetch a resolved track's MP3 (CDN allows cross-origin) as an editable File. */
export async function fetchSunoFile(track: SunoTrack, signal?: AbortSignal): Promise<File> {
  const res = await fetch(track.audioUrl, { signal });
  if (!res.ok) throw new Error(`Could not fetch “${track.title}” (${res.status}).`);
  const blob = await res.blob();
  if (blob.type && !blob.type.startsWith('audio/') && blob.type !== 'application/octet-stream') {
    throw new Error('That link did not return an audio file.');
  }
  const safe = track.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'suno';
  return new File([blob], `${safe}.mp3`, { type: blob.type?.startsWith('audio/') ? blob.type : 'audio/mpeg' });
}
