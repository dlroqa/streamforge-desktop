/**
 * Client for the HyperFrames motion-graphics render service
 * (hyperframes-service/ — see its README). Turns a text prompt into a short
 * rendered video via a built-in template or a Claude-authored composition.
 *
 * Default output is WebM with an alpha channel, so the graphic composites
 * transparently over the stream or timeline. The service is pluggable via
 * VITE_HYPERFRAMES_ENDPOINT; the default "/hyperframes" is proxied by the
 * Vite dev server to localhost:8791 (see vite.config.ts) so the browser only
 * needs to reach the app itself — required for remote/forwarded-port dev.
 */

export const HYPERFRAMES_ENDPOINT =
  (import.meta.env.VITE_HYPERFRAMES_ENDPOINT as string | undefined) || '/hyperframes';

export type MotionMode = 'template' | 'llm';
export type MotionFormat = 'webm' | 'mp4';

/** Server-side job phases, in order. */
export type MotionPhase = 'queued' | 'authoring' | 'validating' | 'rendering' | 'done' | 'error';

export const PHASE_LABEL: Record<MotionPhase, string> = {
  queued: 'Waiting in queue…',
  authoring: 'Authoring composition…',
  validating: 'Validating…',
  rendering: 'Rendering video…',
  done: 'Done',
  error: 'Failed',
};

export interface MotionTemplate {
  id: string;
  name: string;
  hint: string;
}

/** Built-in templates (templates.mjs on the service). */
export const MOTION_TEMPLATES: MotionTemplate[] = [
  { id: 'kinetic-title', name: 'Kinetic Title', hint: 'Big animated headline with a subtitle' },
  { id: 'lower-third', name: 'Lower Third', hint: 'Name / role bar that slides in from the side' },
  { id: 'badge', name: 'Badge', hint: 'Pulsing pill callout — LIVE, SALE, NEW…' },
  { id: 'news-lower-third', name: 'News Lower Third', hint: 'Broadcast bar with a logo bug, LIVE tag + ticker' },
  { id: 'glitch-title', name: 'Glitch Title', hint: 'RGB-split headline with a datamosh flicker' },
  { id: 'cinematic-title', name: 'Cinematic Title', hint: 'Elegant wide-tracked serif between two rules' },
  { id: 'neon-sign', name: 'Neon Sign', hint: 'Glowing neon text that flickers to life' },
];

/** An option for one of the animation / style knobs. */
export interface MotionOption {
  id: string;
  label: string;
}

/** Entrance animations (how the whole graphic arrives). 'auto' = the
 * template's own signature entrance. */
export const MOTION_ENTERS: MotionOption[] = [
  { id: 'auto', label: 'Auto (template)' },
  { id: 'pop', label: 'Pop in' },
  { id: 'fade', label: 'Fade in' },
  { id: 'zoom', label: 'Zoom in' },
  { id: 'bounce', label: 'Bounce in' },
  { id: 'flip', label: 'Flip in' },
  { id: 'blur', label: 'Blur in' },
  { id: 'swipe-left', label: 'Swipe in ←' },
  { id: 'swipe-right', label: 'Swipe in →' },
  { id: 'swipe-up', label: 'Swipe in ↑' },
  { id: 'swipe-down', label: 'Swipe in ↓' },
];

/** Exit animations (how it leaves). 'auto' = template default, 'none' = hold. */
export const MOTION_EXITS: MotionOption[] = [
  { id: 'auto', label: 'Auto (template)' },
  { id: 'none', label: 'Hold (no exit)' },
  { id: 'pop', label: 'Pop out' },
  { id: 'fade', label: 'Fade out' },
  { id: 'zoom', label: 'Zoom out' },
  { id: 'flip', label: 'Flip out' },
  { id: 'blur', label: 'Blur out' },
  { id: 'swipe-left', label: 'Swipe out ←' },
  { id: 'swipe-right', label: 'Swipe out →' },
  { id: 'swipe-up', label: 'Swipe out ↑' },
  { id: 'swipe-down', label: 'Swipe out ↓' },
];

/** Animated frame around the graphic. */
export const MOTION_BORDERS: MotionOption[] = [
  { id: 'none', label: 'None' },
  { id: 'glow', label: 'Glow pulse' },
  { id: 'draw', label: 'Draw on' },
  { id: 'marching', label: 'Marching ants' },
  { id: 'gradient', label: 'Rotating gradient' },
  { id: 'corners', label: 'Corner brackets' },
];

/** Premium web fonts (loaded from Google Fonts on the render service). 'auto'
 * lets each template use its own best-fit default. */
export const MOTION_FONTS: MotionOption[] = [
  { id: 'auto', label: 'Auto (template)' },
  { id: 'inter', label: 'Inter' },
  { id: 'montserrat', label: 'Montserrat' },
  { id: 'poppins', label: 'Poppins' },
  { id: 'spacegrotesk', label: 'Space Grotesk' },
  { id: 'bebas', label: 'Bebas Neue' },
  { id: 'oswald', label: 'Oswald' },
  { id: 'anton', label: 'Anton' },
  { id: 'archivo', label: 'Archivo Black' },
  { id: 'playfair', label: 'Playfair Display' },
  { id: 'righteous', label: 'Righteous' },
  { id: 'orbitron', label: 'Orbitron' },
  { id: 'pacifico', label: 'Pacifico' },
];

export interface MotionSize {
  id: string;
  label: string;
  width: number;
  height: number;
}

/** Sizes the service accepts. */
export const MOTION_SIZES: MotionSize[] = [
  { id: '1920x1080', label: 'Landscape 16:9', width: 1920, height: 1080 },
  { id: '1080x1920', label: 'Portrait 9:16', width: 1080, height: 1920 },
  { id: '1080x1080', label: 'Square 1:1', width: 1080, height: 1080 },
];

export interface MotionParams {
  prompt: string;
  mode: MotionMode;
  template?: string;
  format?: MotionFormat;
  width?: number;
  height?: number;
  /** Seconds, clamped to 2–15 by the service. */
  duration?: number;
  /** #rrggbb */
  accentColor?: string;
  /** #rrggbb — second colour for gradient borders / glitch channels. */
  secondaryColor?: string;
  /** Entrance animation id (see MOTION_ENTERS); 'auto' = template default. */
  enter?: string;
  /** Exit animation id (see MOTION_EXITS). */
  exit?: string;
  /** Animated border id (see MOTION_BORDERS). */
  border?: string;
  /** Premium font id (see MOTION_FONTS); 'auto' = template default. */
  font?: string;
  /** Short logo text / bug for the news lower third. */
  logoText?: string;
}

export interface HyperframesHealth {
  ok: boolean;
  /** AI mode available (service has an ANTHROPIC_API_KEY). */
  llm: boolean;
}

/** Probe the render service; null when unreachable. */
export async function checkHyperframes(signal?: AbortSignal): Promise<HyperframesHealth | null> {
  try {
    const res = await fetch(`${HYPERFRAMES_ENDPOINT}/health`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    return { ok: !!data.ok, llm: !!data.llm };
  } catch {
    return null;
  }
}

const POLL_MS = 1500;
const MAX_POLL_MS = 6 * 60 * 1000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

/** Generate a motion graphic: submit the job, poll it (reporting each phase),
 * then download the render as a File ready for overlays / uploads / bins. */
export async function generateMotionGraphic(
  params: MotionParams,
  onPhase?: (phase: MotionPhase, progress: number) => void,
  signal?: AbortSignal,
): Promise<File> {
  const format: MotionFormat = params.format === 'mp4' ? 'mp4' : 'webm';

  const submit = await fetch(`${HYPERFRAMES_ENDPOINT}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, format }),
    signal,
  });
  if (!submit.ok) {
    const err = await submit.json().catch(() => null);
    throw new Error(err?.error || `Generate request failed (${submit.status})`);
  }
  const { jobId } = await submit.json();

  const deadline = Date.now() + MAX_POLL_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error('Render timed out — the service may be stuck.');
    const res = await fetch(`${HYPERFRAMES_ENDPOINT}/jobs/${jobId}`, { signal });
    if (!res.ok) throw new Error(`Lost the render job (${res.status})`);
    const job = await res.json();
    onPhase?.(job.status as MotionPhase, Number(job.progress) || 0);
    if (job.status === 'error') throw new Error(job.error || 'Render failed');
    if (job.status === 'done') break;
    await sleep(POLL_MS, signal);
  }

  const dl = await fetch(`${HYPERFRAMES_ENDPOINT}/renders/${jobId}.${format}`, { signal });
  if (!dl.ok) throw new Error(`Could not download the render (${dl.status})`);
  const blob = await dl.blob();
  const base = params.prompt.split(/\r?\n|\|/)[0].trim().slice(0, 40).replace(/[^\w -]+/g, '').trim() || 'motion-graphic';
  return new File([blob], `${base}.${format}`, { type: format === 'mp4' ? 'video/mp4' : 'video/webm' });
}
