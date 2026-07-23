// A free stock item the user has pulled into the editor's Media bin. Audio and
// video blobs live in IndexedDB (referenced by assetId, same store the music
// uploads use); photos keep an inline data URL so they persist as overlay srcs.
import type { StockKind } from '@/lib/stockMedia';
import { putAsset, getAssetUrl, getMeta, putMeta } from '@/lib/editorAssets';
import { probeDuration } from '@/lib/editorMedia';

export interface StockMediaItem {
  /** Also used as the video clip's recordingId, so the resolver can find it. */
  id: string;
  kind: StockKind;
  /** Bin label the user asked for — always "Stock". */
  name: string;
  /** Original stock title, kept for the tooltip. */
  title: string;
  /** Seconds (audio/video). */
  duration: number;
  /** Small preview for the bin. */
  thumbnail?: string;
  /** IndexedDB asset key — audio/video. */
  assetId?: string;
  /** Inline image data URL — photos (used as the overlay src). */
  dataUrl?: string;
  width?: number;
  height?: number;
}

/** Meta key the Video Editor's Media bin loads/saves its imported clips under. */
const STOCK_BIN_KEY = 'stock-bin';

/** Store a generated motion graphic like a stock clip and drop it into the
 * Video Editor's Media bin (as "Motion"). Persists to the same Supabase-backed
 * store the editor hydrates from, so a graphic added in the Studio shows up in
 * the editor's left Media panel — trimmable and exportable like any clip. */
export async function addMotionGraphicToEditorBin(
  file: File,
  meta: { prompt: string; width: number; height: number; duration: number },
): Promise<void> {
  const assetId = await putAsset(file);
  const assetUrl = await getAssetUrl(assetId);
  const duration = assetUrl ? await probeDuration(assetUrl) : meta.duration;
  const item: StockMediaItem = {
    id: `stock-${assetId}`, kind: 'video', name: 'Motion',
    title: meta.prompt.slice(0, 80) || 'Motion graphic', duration, assetId,
    width: meta.width, height: meta.height,
  };
  const existing = (await getMeta<StockMediaItem[]>(STOCK_BIN_KEY)) ?? [];
  await putMeta(STOCK_BIN_KEY, [item, ...existing]);
}

/** Read a blob as a data URL (used to persist stock photos in the project). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
