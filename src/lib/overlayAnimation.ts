// Overlay motion for the video editor: preset in/out animations today,
// general keyframes tomorrow. Pure module — no React, no renderer imports.
// The renderer calls sampleOverlayMotion(...) per frame; presets and
// keyframes are separate stages of one sampler so preset edits stay
// non-destructive and full keyframe editing can be added without reworking
// the schema or the renderer.

export type EasingId = 'linear' | 'easeOutCubic' | 'easeInOutCubic' | 'easeOutBack';

export type MotionPresetId =
  | 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'pop' | 'wipe';

export interface MotionPreset {
  preset: MotionPresetId;
  /** Seconds. Clamped to half the overlay length at sample time. */
  duration: number;
  easing: EasingId;
}

/** Properties the motion system can vary over time. x/y are canvas
 * fractions (matching EditorOverlay), rotation is radians. */
export interface AnimatableProps {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  rotation: number;
}

/** A keyframe at `t` seconds from the overlay's start. Written by the
 * keyframe UI (Phase B); the sampler already interpolates them. */
export interface OverlayKeyframe {
  t: number;
  props: Partial<AnimatableProps>;
  /** Easing INTO this keyframe (from the previous one). */
  easing?: EasingId;
}

export interface OverlayAnimation {
  in?: MotionPreset;
  out?: MotionPreset;
  keyframes?: OverlayKeyframe[];
}

/** Resolved per-frame motion. x/y are the final center (fractions, slide
 * offsets included). wipe is the visible fraction of the block (1 = fully
 * shown), revealed from wipeAnchor's edge. */
export interface SampledMotion {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  rotation: number;
  wipe: number;
  wipeAnchor: 'left' | 'right' | null;
}

/** Drawn bounds of the overlay in canvas px — feeds slide offscreen
 * distances and wipe clip rects. */
export interface OverlayBounds { bx: number; by: number; bw: number; bh: number; }

export const EASINGS: Record<EasingId, (t: number) => number> = {
  linear: t => t,
  easeOutCubic: t => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  // Overshoots past 1 near the end — used for "pop"
  easeOutBack: t => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export const EASING_OPTIONS: { id: EasingId; label: string }[] = [
  { id: 'easeOutCubic', label: 'Ease out' },
  { id: 'easeInOutCubic', label: 'Ease in-out' },
  { id: 'easeOutBack', label: 'Overshoot' },
  { id: 'linear', label: 'Linear' },
];

export const MOTION_PRESET_OPTIONS: { id: MotionPresetId; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'slide-left', label: 'Slide left' },
  { id: 'slide-right', label: 'Slide right' },
  { id: 'slide-up', label: 'Slide up' },
  { id: 'pop', label: 'Pop' },
  { id: 'wipe', label: 'Wipe' },
];

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const IDENTITY: Omit<SampledMotion, 'x' | 'y'> = {
  scale: 1, opacity: 1, rotation: 0, wipe: 1, wipeAnchor: null,
};

/** Interpolate keyframed channels at `localTime`. Holds before the first and
 * after the last keyframe of each channel; eases into each keyframe.
 * Exported for the keyframe UI (capture-at-playhead) and split pinning. */
export function sampleKeyframeProps(
  base: AnimatableProps, keyframes: OverlayKeyframe[], localTime: number,
): AnimatableProps {
  const out = { ...base };
  const sorted = [...keyframes].sort((a, b) => a.t - b.t);
  for (const channel of ['x', 'y', 'scale', 'opacity', 'rotation'] as const) {
    const kfs = sorted.filter(k => k.props[channel] !== undefined);
    if (kfs.length === 0) continue;
    if (localTime <= kfs[0].t) { out[channel] = kfs[0].props[channel]!; continue; }
    const last = kfs[kfs.length - 1];
    if (localTime >= last.t) { out[channel] = last.props[channel]!; continue; }
    const idx = kfs.findIndex(k => k.t > localTime);
    const a = kfs[idx - 1];
    const b = kfs[idx];
    const p = (localTime - a.t) / (b.t - a.t);
    out[channel] = lerp(a.props[channel]!, b.props[channel]!, EASINGS[b.easing ?? 'linear'](p));
  }
  return out;
}

/** Apply one preset envelope. `p` is eased progress toward fully-visible
 * (1 = at rest): the in stage ramps 0→1, the out stage ramps 1→0. */
function applyPreset(
  m: SampledMotion, preset: MotionPresetId, p: number, phase: 'in' | 'out',
  frameW: number, frameH: number, bounds: OverlayBounds,
) {
  switch (preset) {
    case 'fade':
      m.opacity *= clamp01(p);
      break;
    case 'slide-left': {
      // Fully offscreen left at p=0 → rest at p=1, with a mild fade so
      // nothing hard-pops at the frame edge.
      const dist = bounds.bx + bounds.bw;
      m.x -= (dist * (1 - p)) / frameW;
      m.opacity *= clamp01(p * 2);
      break;
    }
    case 'slide-right': {
      const dist = frameW - bounds.bx;
      m.x += (dist * (1 - p)) / frameW;
      m.opacity *= clamp01(p * 2);
      break;
    }
    case 'slide-up': {
      // Enters from below the bottom edge (and exits back down).
      const dist = frameH - bounds.by;
      m.y += (dist * (1 - p)) / frameH;
      m.opacity *= clamp01(p * 2);
      break;
    }
    case 'pop':
      m.scale *= lerp(0.6, 1, p);
      m.opacity *= clamp01(p * 2);
      break;
    case 'wipe':
      m.wipe = Math.min(m.wipe, clamp01(p));
      m.wipeAnchor = phase === 'in' ? 'left' : 'right';
      break;
  }
}

/**
 * Resolve an overlay's motion at `localTime` seconds into its visible window
 * of `length` seconds. Stages compose: base position → keyframe channels
 * (Phase B data) → in/out preset envelopes on top.
 */
export function sampleOverlayMotion(
  base: { x: number; y: number; scale?: number; opacity?: number },
  animation: OverlayAnimation | undefined,
  localTime: number,
  length: number,
  frameW: number,
  frameH: number,
  bounds: OverlayBounds,
): SampledMotion {
  const baseProps: AnimatableProps = {
    x: base.x, y: base.y, scale: base.scale ?? 1, opacity: base.opacity ?? 1, rotation: 0,
  };
  const kf = animation?.keyframes?.length
    ? sampleKeyframeProps(baseProps, animation.keyframes, localTime)
    : baseProps;
  const m: SampledMotion = { ...IDENTITY, ...kf };
  if (!animation) return m;

  // Clamp each window to half the overlay so in/out never overlap.
  const inn = animation.in;
  if (inn && inn.preset !== 'none' && inn.duration > 0) {
    const dur = Math.min(inn.duration, length / 2);
    if (localTime < dur) {
      const p = EASINGS[inn.easing ?? 'easeOutCubic'](clamp01(localTime / dur));
      applyPreset(m, inn.preset, p, 'in', frameW, frameH, bounds);
    }
  }
  const out = animation.out;
  if (out && out.preset !== 'none' && out.duration > 0) {
    const dur = Math.min(out.duration, length / 2);
    if (localTime > length - dur) {
      const q = EASINGS[out.easing ?? 'easeInOutCubic'](clamp01((localTime - (length - dur)) / dur));
      applyPreset(m, out.preset, 1 - q, 'out', frameW, frameH, bounds);
    }
  }
  return m;
}

// ── Keyframe editing ────────────────────────────────────────────────────────
// Storage order is irrelevant (the sampler sorts a copy), so retiming by
// index during a drag is safe without re-sorting mid-gesture.

/** Two keyframes within one 30fps frame are "the same" keyframe. */
export const KF_EPSILON = 1 / 30;

/** Index of the keyframe nearest `t` within epsilon, or -1. */
export function findKeyframeIndexAt(
  keyframes: OverlayKeyframe[] | undefined, t: number, epsilon = KF_EPSILON,
): number {
  if (!keyframes?.length) return -1;
  let best = -1;
  let bestDist = epsilon;
  keyframes.forEach((k, i) => {
    const d = Math.abs(k.t - t);
    if (d <= bestDist) { best = i; bestDist = d; }
  });
  return best;
}

/** Add a keyframe at `t`, or merge props into the one already there. */
export function upsertKeyframe(
  animation: OverlayAnimation | undefined, t: number,
  props: Partial<AnimatableProps>, easing?: EasingId,
): OverlayAnimation {
  const anim = animation ?? {};
  const kfs = [...(anim.keyframes ?? [])];
  const i = findKeyframeIndexAt(kfs, t);
  if (i >= 0) {
    kfs[i] = { ...kfs[i], props: { ...kfs[i].props, ...props }, ...(easing ? { easing } : null) };
  } else {
    kfs.push({ t, props, easing: easing ?? 'easeInOutCubic' });
  }
  return { ...anim, keyframes: kfs };
}

export function removeKeyframe(
  animation: OverlayAnimation | undefined, index: number,
): OverlayAnimation | undefined {
  if (!animation?.keyframes) return animation;
  const kfs = animation.keyframes.filter((_, i) => i !== index);
  return { ...animation, keyframes: kfs.length ? kfs : undefined };
}

export function retimeKeyframe(
  animation: OverlayAnimation | undefined, index: number, t: number,
): OverlayAnimation | undefined {
  if (!animation?.keyframes?.[index]) return animation;
  return {
    ...animation,
    keyframes: animation.keyframes.map((k, i) => (i === index ? { ...k, t } : k)),
  };
}

export function setKeyframeEasing(
  animation: OverlayAnimation | undefined, index: number, easing: EasingId,
): OverlayAnimation | undefined {
  if (!animation?.keyframes?.[index]) return animation;
  return {
    ...animation,
    keyframes: animation.keyframes.map((k, i) => (i === index ? { ...k, easing } : k)),
  };
}

/** Shift every keyframe by `delta` seconds and drop any outside [0, length].
 * Used when an overlay edge is trimmed: times are relative to the overlay's
 * start, so a left trim re-anchors them to keep their absolute position. */
export function shiftKeyframes(
  animation: OverlayAnimation | undefined, delta: number, length: number,
): OverlayAnimation | undefined {
  if (!animation?.keyframes?.length) return animation;
  const kfs = animation.keyframes
    .map(k => ({ ...k, t: k.t + delta }))
    .filter(k => k.t >= -1e-9 && k.t <= length + 1e-9);
  return { ...animation, keyframes: kfs.length ? kfs : undefined };
}
