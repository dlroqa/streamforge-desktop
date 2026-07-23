// Browser-based video stabilization via ffmpeg.wasm's built-in `deshake`
// filter. We use the OFFICIAL single-threaded @ffmpeg/core (no SharedArrayBuffer
// → no cross-origin isolation, keeping the app's deliberate no-COOP/COEP setup
// intact — see asrWorker.ts). The core .js/.wasm are imported as SAME-ORIGIN
// Vite assets and handed to ffmpeg as blob URLs, the same trick the ASR worker
// uses so Brave Shields / strict CSPs never block a cross-origin fetch.
//
// `deshake` is a one-pass motion-search stabilizer that ships in the stock core
// (verified: the core wasm exports the filter; `vidstab` is NOT built in). It's
// a notch below desktop vid.stab on extreme motion but needs no custom build.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { MODELS_BASE } from './whisperConfig';

// The ~32MB core is hosted in the public Supabase `models` bucket (over
// Cloudflare Workers' 25 MiB per-asset cap, so it can't ship in dist/). We fetch
// it cross-origin via toBlobURL — a plain fetch, like the ASR model files, so
// it isn't blocked by Brave/CSP the way path-based wasm loading is. Upload once
// with `npm run upload:ffmpeg` (scripts/upload-ffmpeg-core.mjs).
const CORE_JS = `${MODELS_BASE}ffmpeg/ffmpeg-core.js`;
const CORE_WASM = `${MODELS_BASE}ffmpeg/ffmpeg-core.wasm`;

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

/** Lazily create and load the ffmpeg.wasm instance (once per session). */
async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  if (!loadPromise) {
    loadPromise = (async () => {
      const instance = new FFmpeg();
      await instance.load({
        coreURL: await toBlobURL(CORE_JS, 'text/javascript'),
        wasmURL: await toBlobURL(CORE_WASM, 'application/wasm'),
      });
      ffmpeg = instance;
      return instance;
    })();
  }
  return loadPromise;
}

/** Map a 0–1 strength to deshake's motion-search range in pixels (rx/ry).
 *  Bigger range = catches larger shake but softer/slower. */
function searchRange(strength: number): number {
  return Math.round(8 + Math.max(0, Math.min(1, strength)) * 56); // 8–64 px
}

export interface StabilizeOptions {
  /** 0–1; higher tolerates larger shake. */
  strength?: number;
  /** 0–1 progress of the encode. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Run `deshake` over a source video blob and return a stabilized MP4 (H.264 +
 * AAC) blob. Audio is preserved so the editor's volume / mute / fade still work.
 * Throws on load/exec failure so the caller can surface it and revert the toggle.
 */
export async function stabilizeVideo(source: Blob, opts: StabilizeOptions = {}): Promise<Blob> {
  const strength = opts.strength ?? 0.5;
  const ff = await getFFmpeg();

  const onProgress = ({ progress }: { progress: number }) => {
    opts.onProgress?.(Math.max(0, Math.min(1, progress)));
  };
  ff.on('progress', onProgress);

  const abort = () => { try { ff.terminate(); } catch { /* already gone */ } finally { ffmpeg = null; loadPromise = null; } };
  opts.signal?.addEventListener('abort', abort, { once: true });

  const inName = 'stab-in';
  const outName = 'stab-out.mp4';
  try {
    await ff.writeFile(inName, await fetchFile(source));
    const rr = searchRange(strength);
    // edge=clamp fills the exposed border by clamping edge pixels; rx/ry bound
    // the per-frame search. The trailing `format=yuv420p` (and matching
    // -pix_fmt) is REQUIRED: browsers only decode H.264 in 4:2:0, and without
    // it deshake can pass through a chroma format the <video> paints as black.
    // -movflags +faststart puts the moov atom up front; -c:a aac re-encodes
    // audio into the mp4 container.
    await ff.exec([
      '-i', inName,
      '-vf', `deshake=rx=${rr}:ry=${rr}:edge=clamp,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      outName,
    ]);
    const data = await ff.readFile(outName);
    const bytes = data as Uint8Array;
    return new Blob([bytes], { type: 'video/mp4' });
  } finally {
    ff.off('progress', onProgress);
    opts.signal?.removeEventListener('abort', abort);
    // Best-effort cleanup of the virtual FS so repeat runs don't accumulate.
    try { await ff.deleteFile(inName); } catch { /* may not exist */ }
    try { await ff.deleteFile(outName); } catch { /* may not exist */ }
  }
}
