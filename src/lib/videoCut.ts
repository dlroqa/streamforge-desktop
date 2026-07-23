/**
 * "Video Cut": load a video into the editor from a URL so it can be trimmed and
 * exported like any other clip.
 *
 * Two paths, because the browser can't fetch a social-media stream directly
 * (CORS-blocked):
 *  1. A direct video file URL (.mp4/.webm/.mov/…) is fetched straight to a blob.
 *  2. An X (Twitter) or Facebook link is handed to a backend resolver
 *     endpoint that returns the actual file. The endpoint is pluggable via
 *     VITE_VIDEO_CUT_ENDPOINT (defaults to "/video-cut"); you supply the
 *     downloader (a yt-dlp service) and must have the rights to the video.
 *
 * YouTube and Rumble are intentionally not supported — both IP-block hosted
 * downloaders (YouTube outright; Rumble via Cloudflare).
 */

/** Backend that turns a non-direct link into a fetchable video file. */
export const VIDEO_CUT_ENDPOINT =
  (import.meta.env.VITE_VIDEO_CUT_ENDPOINT as string | undefined) || '/video-cut';

const DIRECT_VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv|ogg|mkv)(\?|#|$)/i;

export type VideoUrlKind = 'direct' | 'twitter' | 'facebook' | 'rumble' | 'youtube' | 'other';

/** Platforms the backend downloader resolves (yt-dlp). */
export const SUPPORTED_PLATFORMS = ['X (Twitter)', 'Facebook'] as const;

/** Human label for a classified URL. */
export const PLATFORM_LABEL: Record<VideoUrlKind, string> = {
  direct: 'Direct video file',
  twitter: 'X (Twitter)',
  facebook: 'Facebook',
  rumble: 'Rumble',
  youtube: 'YouTube',
  other: 'Link',
};

export function classifyVideoUrl(raw: string): VideoUrlKind {
  if (DIRECT_VIDEO_RE.test(raw)) return 'direct';
  let host: string;
  try { host = new URL(raw.trim()).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return 'other'; }
  if (host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) return 'youtube';
  if (host === 'x.com' || host.endsWith('.x.com') || host.endsWith('twitter.com') || host === 't.co') return 'twitter';
  if (host.endsWith('facebook.com') || host === 'fb.watch' || host.endsWith('fb.com')) return 'facebook';
  if (host.endsWith('rumble.com')) return 'rumble';
  return 'other';
}

/** A URL is loadable if it looks like a direct file or a recognised link. */
export function isLikelyVideoUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  try { new URL(t); } catch { return false; }
  return true;
}

function fileNameFromUrl(url: string, fallback = 'video-cut'): string {
  try {
    const base = new URL(url).pathname.split('/').pop() || '';
    const clean = decodeURIComponent(base).replace(/\.[^.]+$/, '').replace(/[^\w\s-]/g, '').trim();
    return clean.slice(0, 60) || fallback;
  } catch { return fallback; }
}

async function blobToFile(blob: Blob, name: string): Promise<File> {
  const type = blob.type || 'video/mp4';
  const ext = type.split('/')[1]?.split(';')[0] || 'mp4';
  return new File([blob], `${name}.${ext}`, { type });
}

/** Fetch a direct video file URL and wrap it as an editable File. */
async function fetchDirect(url: string, signal?: AbortSignal): Promise<File> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Could not fetch video (${res.status})`);
  const blob = await res.blob();
  if (blob.type && !blob.type.startsWith('video/')) {
    throw new Error('That URL did not return a video file.');
  }
  return blobToFile(blob, fileNameFromUrl(url));
}

interface VideoCutResolveResult {
  /** Direct, fetchable file URL the backend produced. */
  url?: string;
  title?: string;
  error?: string;
}

/** Container the backend resolver should return for link-based sources. */
export type VideoContainer = 'mp4' | 'webm';

/** Ask the backend resolver to turn a link (e.g. YouTube) into a video file. */
async function fetchViaBackend(url: string, format: VideoContainer, signal?: AbortSignal): Promise<File> {
  let res: Response;
  try {
    res = await fetch(VIDEO_CUT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format }),
      signal,
    });
  } catch {
    throw new Error(
      `No Video Cut resolver is available. Set up a downloader at ${VIDEO_CUT_ENDPOINT} ` +
      `(or paste a direct .mp4/.webm URL instead).`,
    );
  }

  // A static host (no backend) answers a POST with 404/405/501. Make that the
  // clear "no resolver" case rather than a cryptic status code.
  if (res.status === 404 || res.status === 405 || res.status === 501) {
    throw new Error(
      `No Video Cut resolver is deployed at ${VIDEO_CUT_ENDPOINT}. Stand up the ` +
      `downloader service and set VITE_VIDEO_CUT_ENDPOINT to its URL — or paste a ` +
      `direct .mp4/.webm link, which works without a backend.`,
    );
  }

  const contentType = res.headers.get('content-type') || '';

  // The resolver may stream the file back directly…
  if (res.ok && contentType.startsWith('video/')) {
    const blob = await res.blob();
    return blobToFile(blob, fileNameFromUrl(url));
  }

  // …or return JSON pointing at a fetchable file.
  if (contentType.includes('application/json')) {
    const data = (await res.json().catch(() => ({}))) as VideoCutResolveResult;
    if (!res.ok || data.error) throw new Error(data.error || `Resolver failed (${res.status})`);
    if (!data.url) throw new Error('Resolver did not return a video URL.');
    const file = await fetchDirect(data.url, signal);
    return data.title ? new File([file], `${data.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'video-cut'}.${file.name.split('.').pop()}`, { type: file.type }) : file;
  }

  throw new Error(`Resolver returned an unexpected response (${res.status}).`);
}

/** Resolve any supported URL to an editable video File. `format` applies only
 * to link-based sources (YouTube/other); a direct file URL is used as-is. */
export async function resolveVideoCut(
  raw: string,
  opts: { format?: VideoContainer; signal?: AbortSignal } = {},
): Promise<File> {
  const url = raw.trim();
  if (!isLikelyVideoUrl(url)) throw new Error('Please paste a valid video URL.');
  const kind = classifyVideoUrl(url);
  if (kind === 'youtube' || kind === 'rumble') {
    throw new Error(
      `${PLATFORM_LABEL[kind]} links aren’t supported. Use an X (Twitter) or Facebook link, or a direct .mp4/.webm URL.`,
    );
  }
  return kind === 'direct'
    ? fetchDirect(url, opts.signal)
    : fetchViaBackend(url, opts.format ?? 'mp4', opts.signal);
}
