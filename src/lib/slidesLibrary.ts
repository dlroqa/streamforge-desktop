// Per-account slides library. PDF decks the host uploads in the studio's Slides
// panel are stored so they follow the account across devices: the PDF blob goes
// to the private `editor-assets` bucket (via the shared asset helpers) and a
// small index — name, page count, and a page-1 thumbnail data URL — is kept in
// the `editor_meta` table under one key. Capped at MAX_SLIDES decks.

import { putAsset, deleteAsset, getAssetUrl, getMeta, putMeta, deleteMeta } from './editorAssets';

const META_KEY = 'studio_slides';
// Per-deck rendered page thumbnails live under their own meta key so the light
// deck index (page-1 thumb only) stays small. Persisting them means the picker's
// full render is remembered for the account — every session and device skips it.
const pagesKey = (id: string) => `studio_slide_pages:${id}`;
export const MAX_SLIDES = 6;
const THUMB_WIDTH = 360; // px; kept small so the data URL stays light in the meta row

export interface SlideDoc {
  id: string;        // opaque asset id (storage path is `${userId}/${id}`)
  name: string;      // original filename, e.g. "deck.pdf"
  pages: number;
  thumb: string;     // page-1 preview as a JPEG data URL
  addedAt: number;   // epoch ms
}

/** Open a PDF file with PDF.js (worker wired up). Same path the live slideshow
 *  uses, so anything that presents also previews. */
async function openPdf(file: File) {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

/** Render one PDF page to a JPEG data URL, fit to `maxWidth`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pageToThumb(page: any, maxWidth: number, quality: number): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidth / base.width, 4);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
  return canvas.toDataURL('image/jpeg', quality);
}

/** Render page 1 to a light JPEG data URL and count pages (for the deck card). */
async function renderPdfPreview(file: File): Promise<{ pages: number; thumb: string }> {
  const pdf = await openPdf(file);
  const thumb = await pageToThumb(await pdf.getPage(1), THUMB_WIDTH, 0.72);
  return { pages: pdf.numPages, thumb };
}

export interface PageThumb {
  page: number; // 1-based
  thumb: string;
}

/** Render every page of a stored deck to a small thumbnail, streaming each one
 *  to `onPage` as it finishes so the picker fills in progressively. Pass a
 *  `signal` whose `cancelled` flag can be flipped to stop a long render. */
export async function renderAllPages(
  doc: SlideDoc,
  onPage: (p: PageThumb) => void,
  signal?: { cancelled: boolean },
): Promise<void> {
  const pdf = await openPdf(await slideFile(doc));
  for (let n = 1; n <= pdf.numPages; n++) {
    if (signal?.cancelled) return;
    // Rendered larger than the grid cell so the hover preview stays crisp.
    const thumb = await pageToThumb(await pdf.getPage(n), 480, 0.68);
    if (signal?.cancelled) return;
    onPage({ page: n, thumb });
  }
}

export async function listSlides(): Promise<SlideDoc[]> {
  return (await getMeta<SlideDoc[]>(META_KEY)) ?? [];
}

// Session cache so re-expanding a deck within one session skips even the meta
// fetch. Persisted rows survive across sessions/devices via editor_meta.
const pageCache = new Map<string, PageThumb[]>();

/** Load a deck's persisted page thumbnails, or null if none are saved yet. */
export async function loadPageThumbs(doc: SlideDoc): Promise<PageThumb[] | null> {
  const mem = pageCache.get(doc.id);
  if (mem) return mem;
  const saved = await getMeta<PageThumb[]>(pagesKey(doc.id));
  if (saved) pageCache.set(doc.id, saved);
  return saved;
}

/** Persist a fully-rendered set of page thumbnails so later sessions and other
 *  devices on the account skip the re-render. */
export async function savePageThumbs(doc: SlideDoc, thumbs: PageThumb[]): Promise<void> {
  pageCache.set(doc.id, thumbs);
  await putMeta(pagesKey(doc.id), thumbs);
}

/** Validate, render a preview, upload the blob, and append to the index.
 *  Throws a readable message when the file isn't a PDF or the library is full.
 *  `onProgress` reports 0→1 across the phases so callers can show a real bar. */
export async function addSlide(file: File, onProgress?: (fraction: number) => void): Promise<SlideDoc[]> {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    throw new Error('Only PDF files can be added. Export PowerPoint/Keynote/Slides to PDF first.');
  }
  onProgress?.(0.1);
  const existing = await listSlides();
  if (existing.length >= MAX_SLIDES) {
    throw new Error(`The library holds up to ${MAX_SLIDES} decks — remove one to add another.`);
  }
  const { pages, thumb } = await renderPdfPreview(file); // render page-1 preview
  onProgress?.(0.5);
  const id = await putAsset(file);                       // upload the deck blob
  onProgress?.(0.9);
  const doc: SlideDoc = { id, name: file.name, pages, thumb, addedAt: Date.now() };
  const next = [...existing, doc];
  await putMeta(META_KEY, next);
  onProgress?.(1);
  return next;
}

/** Drop a deck from the index and delete its stored blob and rendered pages. */
export async function removeSlide(id: string): Promise<SlideDoc[]> {
  const next = (await listSlides()).filter(d => d.id !== id);
  await putMeta(META_KEY, next);
  await deleteAsset(id);
  await deleteMeta(pagesKey(id));
  pageCache.delete(id);
  return next;
}

/** Fetch a stored deck back as a File so it can be handed to the slideshow. */
export async function slideFile(doc: SlideDoc): Promise<File> {
  const url = await getAssetUrl(doc.id);
  if (!url) throw new Error('That deck is no longer available.');
  const blob = await (await fetch(url)).blob();
  return new File([blob], doc.name, { type: 'application/pdf' });
}
