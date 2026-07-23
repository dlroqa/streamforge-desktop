/**
 * Free stock media search for the studio: photos + audio via the Openverse API
 * (openverse.org — CC-licensed catalog, keyless, CORS-enabled) and videos via
 * the Wikimedia Commons API (keyless, CORS via origin=*). Everything returned
 * is Creative-Commons licensed; each item carries creator/license info that the
 * UI must display (CC BY requires attribution).
 *
 * Openverse anonymous rate limits: 20 req/min, 200 req/day — searches run on
 * explicit submit only, never per keystroke.
 */

export type StockKind = 'photo' | 'audio' | 'video';

export interface StockItem {
  id: string;
  kind: StockKind;
  title: string;
  /** Small preview image (photos/videos); absent for audio. */
  thumbnail?: string;
  /** Direct media file URL (full-size image / mp3 / webm…). */
  url: string;
  creator: string;
  /** Short license tag, e.g. "CC BY 2.0", "CC0". */
  license: string;
  licenseUrl?: string;
  /** Human page for the item (attribution / source link). */
  sourceUrl: string;
  /** Seconds, for audio/video when known. */
  duration?: number;
  width?: number;
  height?: number;
  filetype?: string;
}

/* ── Pure response parsers (unit-tested) ── */

interface OpenverseResult {
  id: string;
  title?: string;
  url?: string;
  thumbnail?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  duration?: number; // audio: milliseconds
  width?: number;
  height?: number;
  filetype?: string;
}

/** Openverse "license" is a slug like "by-nc-sa" or "cc0". */
function formatOpenverseLicense(license?: string, version?: string): string {
  if (!license) return 'CC';
  const l = license.toLowerCase();
  if (l === 'cc0') return 'CC0';
  if (l === 'pdm') return 'Public Domain';
  return `CC ${l.toUpperCase()}${version ? ` ${version}` : ''}`;
}

export function parseOpenverseResults(json: unknown, kind: 'photo' | 'audio'): StockItem[] {
  const results = (json as { results?: OpenverseResult[] })?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter(r => r && typeof r.id === 'string' && typeof r.url === 'string')
    .map(r => ({
      id: r.id,
      kind,
      title: r.title || 'Untitled',
      thumbnail: r.thumbnail,
      url: r.url!,
      creator: r.creator || 'Unknown',
      license: formatOpenverseLicense(r.license, r.license_version),
      licenseUrl: r.license_url,
      sourceUrl: r.foreign_landing_url || r.url!,
      // Openverse reports audio duration in milliseconds
      duration: kind === 'audio' && typeof r.duration === 'number' ? r.duration / 1000 : undefined,
      width: r.width,
      height: r.height,
      filetype: r.filetype ?? undefined,
    }));
}

interface CommonsPage {
  pageid: number;
  title?: string;
  videoinfo?: Array<{
    url?: string;
    thumburl?: string;
    descriptionurl?: string;
    duration?: number;
    width?: number;
    height?: number;
    mime?: string;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }>;
}

/** Strip any HTML Commons puts in metadata values (e.g. Artist links). */
function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim();
}

export function parseCommonsResults(json: unknown): StockItem[] {
  const pages = (json as { query?: { pages?: Record<string, CommonsPage> } })?.query?.pages;
  if (!pages || typeof pages !== 'object') return [];
  return Object.values(pages)
    .filter(p => p?.videoinfo?.[0]?.url)
    .map(p => {
      const vi = p.videoinfo![0];
      const meta = vi.extmetadata ?? {};
      return {
        id: String(p.pageid),
        kind: 'video' as const,
        title: stripHtml(meta.ObjectName?.value || p.title?.replace(/^File:/, '').replace(/\.\w+$/, '') || 'Untitled'),
        thumbnail: vi.thumburl,
        url: vi.url!,
        creator: stripHtml(meta.Artist?.value || 'Unknown'),
        license: meta.LicenseShortName?.value || 'See source',
        licenseUrl: meta.LicenseUrl?.value,
        sourceUrl: vi.descriptionurl || vi.url!,
        duration: typeof vi.duration === 'number' ? vi.duration : undefined,
        width: vi.width,
        height: vi.height,
        filetype: vi.mime?.split('/')[1],
      };
    });
}

/* ── Live search calls ── */

const OPENVERSE = 'https://api.openverse.org/v1';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
export const STOCK_PAGE_SIZE = 20;

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return res.json();
}

export async function searchStockPhotos(query: string, signal?: AbortSignal): Promise<StockItem[]> {
  const u = `${OPENVERSE}/images/?q=${encodeURIComponent(query)}&page_size=${STOCK_PAGE_SIZE}&mature=false`;
  return parseOpenverseResults(await getJson(u, signal), 'photo');
}

export async function searchStockAudio(query: string, signal?: AbortSignal): Promise<StockItem[]> {
  const u = `${OPENVERSE}/audio/?q=${encodeURIComponent(query)}&page_size=${STOCK_PAGE_SIZE}&mature=false`;
  return parseOpenverseResults(await getJson(u, signal), 'audio');
}

export async function searchStockVideos(query: string, signal?: AbortSignal): Promise<StockItem[]> {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    generator: 'search',
    gsrsearch: `filetype:video ${query}`,
    gsrlimit: String(STOCK_PAGE_SIZE),
    gsrnamespace: '6',
    prop: 'videoinfo',
    viprop: 'url|size|mime|extmetadata',
    viurlwidth: '400', // provides thumburl poster frames
  });
  return parseCommonsResults(await getJson(`${COMMONS}?${params}`, signal));
}

/** Fetch a stock file and wrap it as a File, ready for the studio's existing
 * File pipelines (logo overlay, cloud video library) or a local download.
 * Fetching through CORS and re-wrapping as a blob keeps canvases untainted. */
export async function fetchStockFile(item: StockItem, signal?: AbortSignal): Promise<File> {
  const res = await fetch(item.url, { signal });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const ext = item.url.split('.').pop()?.split('?')[0]?.toLowerCase() || item.filetype || 'bin';
  const safe = item.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'stock';
  return new File([blob], `${safe}.${ext}`, { type: blob.type || undefined });
}

/** Trigger a browser download of a fetched stock file. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
