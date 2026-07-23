// Data model for the in-app video editor. A project is a plain, serializable
// object (autosaved to localStorage) describing the timeline: clips on a video
// track, overlays, and per-clip audio. Kept framework-agnostic so the preview
// compositor and the ffmpeg export can both read it.

import { DEFAULT_LOWER_THIRD_BLOCK_STYLE, type LowerThirdBlockStyle } from '@/lib/lowerThird';
import {
  sampleKeyframeProps, shiftKeyframes, retimeKeyframe as retimeAnimKeyframe,
  type OverlayAnimation, type AnimatableProps,
} from '@/lib/overlayAnimation';

export const EDITOR_FPS = 30;

export interface EditorClip {
  id: string;
  /** Source recording id (from the recordings table). */
  recordingId: string;
  /** Display name (for the timeline label). */
  name: string;
  /** Full source media duration in seconds (once known from metadata). */
  sourceDuration: number;
  /** Trim: seconds into the source where this clip starts/ends. */
  inPoint: number;
  outPoint: number;
  /** Where the clip begins on the timeline, in seconds. */
  timelineStart: number;
  /** Audio for this clip. */
  volume: number;   // 0–1
  muted: boolean;
  /** Playback speed multiplier (1 = normal). */
  speed: number;
  /** Fade in/out durations (seconds) — fades video to black + audio. */
  fadeIn: number;
  fadeOut: number;
  /** Reframe/crop: how the source fills the project frame.
   *  'contain' = fit inside (letterbox); 'cover' = fill + crop. */
  fit: 'contain' | 'cover';
  /** Extra zoom on top of the fit scale (1 = none). */
  zoom: number;
  /** When the source overflows the frame, which part shows (0–1). 0.5 = centered. */
  panX: number;
  panY: number;
  /** ── Video Inspector ── */
  /** Compositing: how the clip blends with what's beneath it (default 'normal'). */
  blendMode?: BlendModeId;
  /** Compositing: clip opacity, 0–1 (default 1). */
  opacity?: number;
  /** Transform: rotation in degrees around the frame centre (default 0). */
  rotation?: number;
  /** Crop: fraction of the frame trimmed from each edge, 0–0.49 (default 0). */
  cropL?: number;
  cropT?: number;
  cropR?: number;
  cropB?: number;
  /** ── Stabilization (FFmpeg deshake, baked) ── */
  /** When true, the clip plays its stabilized copy (`stabilizedAssetId`). */
  stabilize?: boolean;
  /** Shake-search strength the current bake was produced at (0–1). */
  stabilizeStrength?: number;
  /** Editor-assets id of the baked, stabilized video (undefined until baked). */
  stabilizedAssetId?: string;
  /** Encoder recipe version the current bake used; a bump invalidates older
   *  bakes so they re-render with the fixed pipeline. */
  stabilizeVersion?: number;
  /** ── Layering ── Video track index: 0 = base (gapless), 1 = upper layer
   *  (free-positioned, composited over the base with blendMode/opacity).
   *  Absent = base. */
  track?: number;
}

/** Video track indices. The base track stays gapless (reflow); higher tracks
 *  are free-positioned and composite over lower ones bottom-to-top. */
export const BASE_TRACK = 0;
export const UPPER_TRACK = 1;

/** A clip's track, defaulting to the base track for older/un-tagged clips. */
export function clipTrack(c: EditorClip): number {
  return c.track ?? BASE_TRACK;
}

/** Bump when the stabilize encode recipe changes (stabilize.ts) so existing
 *  baked copies are treated as stale and re-generated. v2 = yuv420p fix. */
export const STABILIZE_VERSION = 2;

/** The media source a clip should load: its baked stabilized copy when
 *  stabilization is on, otherwise the original recording. The `stab:` prefix
 *  keeps stabilized and original variants of the same recording on distinct
 *  keys (separate <video> elements) and tells the resolver which store to hit. */
export function clipSourceId(clip: EditorClip): string {
  return clip.stabilize && clip.stabilizedAssetId ? `stab:${clip.stabilizedAssetId}` : clip.recordingId;
}

/** Blend modes for clip compositing: FCP-style names mapped to the canvas
 *  globalCompositeOperation the shared renderer applies. Grouped like the FCP
 *  menu (darken / lighten / contrast / inversion / components); modes with no
 *  canvas equivalent (Linear Burn, Vivid Light, Stencil…) are omitted. */
export const BLEND_MODES: { id: string; label: string; op: GlobalCompositeOperation; group: number }[] = [
  { id: 'normal', label: 'Normal', op: 'source-over', group: 0 },
  { id: 'darken', label: 'Darken', op: 'darken', group: 1 },
  { id: 'multiply', label: 'Multiply', op: 'multiply', group: 1 },
  { id: 'color-burn', label: 'Color Burn', op: 'color-burn', group: 1 },
  { id: 'add', label: 'Add', op: 'lighter', group: 2 },
  { id: 'lighten', label: 'Lighten', op: 'lighten', group: 2 },
  { id: 'screen', label: 'Screen', op: 'screen', group: 2 },
  { id: 'color-dodge', label: 'Color Dodge', op: 'color-dodge', group: 2 },
  { id: 'overlay', label: 'Overlay', op: 'overlay', group: 3 },
  { id: 'soft-light', label: 'Soft Light', op: 'soft-light', group: 3 },
  { id: 'hard-light', label: 'Hard Light', op: 'hard-light', group: 3 },
  { id: 'difference', label: 'Difference', op: 'difference', group: 4 },
  { id: 'exclusion', label: 'Exclusion', op: 'exclusion', group: 4 },
  { id: 'hue', label: 'Hue', op: 'hue', group: 5 },
  { id: 'saturation', label: 'Saturation', op: 'saturation', group: 5 },
  { id: 'color', label: 'Color', op: 'color', group: 5 },
  { id: 'luminosity', label: 'Luminosity', op: 'luminosity', group: 5 },
];
export type BlendModeId = typeof BLEND_MODES[number]['id'];

export function blendOpFor(id: BlendModeId | undefined): GlobalCompositeOperation {
  return BLEND_MODES.find(m => m.id === id)?.op ?? 'source-over';
}

/** A clip on the separate music / voiceover audio track. */
export interface EditorAudioClip {
  id: string;
  /** IndexedDB asset key for the uploaded audio blob. */
  assetId: string;
  name: string;
  sourceDuration: number;
  inPoint: number;
  outPoint: number;
  timelineStart: number;
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
}

export type OverlayType = 'text' | 'image' | 'lowerThird';

export interface EditorOverlay {
  id: string;
  type: OverlayType;
  /** Visible window on the timeline, in seconds. */
  start: number;
  end: number;
  /** Center position as a fraction of the frame (0–1). */
  x: number;
  y: number;
  // Text overlay
  text?: string;
  fontSize?: number;   // px in the 1920x1080 design space
  color?: string;
  bgColor?: string | null;
  // Image overlay
  src?: string;
  width?: number;      // fraction of frame width
  // Lower third (position stays on x/y above; ltStyle is position-agnostic)
  title?: string;
  subtitle?: string;
  ltStyle?: LowerThirdBlockStyle;
  // Motion — preset in/out animations + keyframes, any overlay type.
  // opacity/scale are the resting BASE values; keyframes override them.
  animation?: OverlayAnimation;
  opacity?: number;   // 0–1, default 1
  scale?: number;     // multiplier, default 1
}

export interface EditorProject {
  version: 1;
  name: string;
  width: number;
  height: number;
  fps: number;
  clips: EditorClip[];
  overlays: EditorOverlay[];
  audioClips: EditorAudioClip[];
}

export function createEmptyProject(): EditorProject {
  return {
    version: 1,
    name: 'Untitled project',
    width: 1920,
    height: 1080,
    fps: EDITOR_FPS,
    clips: [],
    overlays: [],
    audioClips: [],
  };
}

/** Default framing for a newly added clip (fit inside, centered, no zoom). */
export const DEFAULT_FRAMING = { fit: 'contain' as const, zoom: 1, panX: 0.5, panY: 0.5 };

/** Default Video Inspector state for a clip (no rotation, no crop). */
export const DEFAULT_INSPECTOR = { rotation: 0, cropL: 0, cropT: 0, cropR: 0, cropB: 0 };

/** True when a clip still has its default framing (safe to auto-reframe). */
export function isDefaultFraming(c: EditorClip): boolean {
  return (c.fit ?? 'contain') === 'contain' && (c.zoom ?? 1) === 1
    && (c.panX ?? 0.5) === 0.5 && (c.panY ?? 0.5) === 0.5
    && !(c.rotation || c.cropL || c.cropT || c.cropR || c.cropB);
}

/** Fill defaults for fields added over time (older autosaved projects). */
export function normalizeProject(p: EditorProject): EditorProject {
  return {
    ...p,
    clips: (p.clips ?? []).map(c => ({ speed: 1, fadeIn: 0, fadeOut: 0, track: BASE_TRACK, ...DEFAULT_FRAMING, ...c })),
    overlays: p.overlays ?? [],
    audioClips: p.audioClips ?? [],
  };
}

/** The length of a clip on the timeline (after trimming and speed). */
export function clipLength(clip: EditorClip): number {
  return Math.max(0, (clip.outPoint - clip.inPoint) / (clip.speed || 1));
}

export function clipEnd(clip: EditorClip): number {
  return clip.timelineStart + clipLength(clip);
}

/** Total timeline duration (end of the last clip / overlay / audio clip). */
export function projectDuration(project: EditorProject): number {
  const clipEndMax = project.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const overlayEndMax = project.overlays.reduce((m, o) => Math.max(m, o.end), 0);
  const audioEndMax = (project.audioClips ?? []).reduce((m, a) => Math.max(m, audioClipEnd(a)), 0);
  return Math.max(clipEndMax, overlayEndMax, audioEndMax);
}

export function audioClipLength(a: EditorAudioClip): number {
  return Math.max(0, a.outPoint - a.inPoint);
}
export function audioClipEnd(a: EditorAudioClip): number {
  return a.timelineStart + audioClipLength(a);
}
export function audioClipsAtTime(project: EditorProject, t: number): EditorAudioClip[] {
  return (project.audioClips ?? []).filter(a => t >= a.timelineStart && t < audioClipEnd(a));
}

/** Every video clip active at a timeline time, ordered bottom-to-top (base
 *  track first, upper layers last) — the painter's order for compositing. */
export function clipsAtTime(project: EditorProject, t: number): EditorClip[] {
  return project.clips
    .filter(c => t >= c.timelineStart && t < clipEnd(c))
    .sort((a, b) => clipTrack(a) - clipTrack(b));
}

/** The top-most clip covering a timeline time (highest track wins). Used by UI
 *  and editing that wants "the clip here"; identical to the old single-clip
 *  behavior on a base-only project. */
export function clipAtTime(project: EditorProject, t: number): EditorClip | null {
  const active = clipsAtTime(project, t);
  return active.length ? active[active.length - 1] : null;
}

/** Map a timeline time to the source media time for a clip (speed-aware). */
export function sourceTimeFor(clip: EditorClip, timelineTime: number): number {
  return clip.inPoint + (timelineTime - clip.timelineStart) * (clip.speed || 1);
}

/** Fade envelope (0–1) at localTime within a segment of the given length. */
export function fadeMultiplier(localTime: number, length: number, fadeIn: number, fadeOut: number): number {
  let m = 1;
  if (fadeIn > 0 && localTime < fadeIn) m = Math.min(m, localTime / fadeIn);
  if (fadeOut > 0 && localTime > length - fadeOut) m = Math.min(m, (length - localTime) / fadeOut);
  return Math.max(0, Math.min(1, m));
}

/** Append a clip after the current last clip on the track. */
export function appendClip(
  project: EditorProject,
  rec: { recordingId: string; name: string; sourceDuration: number },
  id: string = crypto.randomUUID(),
): EditorProject {
  // Append after the last BASE-track VIDEO clip — not projectDuration(), which
  // also counts audio/overlays/upper layers. Otherwise a video added while a
  // long music clip (or an upper-layer clip) is present lands way down the
  // timeline (off-screen) and the preview looks empty.
  const start = project.clips
    .filter(c => clipTrack(c) === BASE_TRACK)
    .reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const clip: EditorClip = {
    id,
    recordingId: rec.recordingId,
    name: rec.name,
    sourceDuration: rec.sourceDuration,
    inPoint: 0,
    outPoint: rec.sourceDuration || 0,
    timelineStart: start,
    volume: 1,
    muted: false,
    speed: 1,
    fadeIn: 0,
    fadeOut: 0,
    ...DEFAULT_FRAMING,
  };
  return { ...project, clips: [...project.clips, clip] };
}

/** Re-flow the BASE track so its clips sit end-to-end in array order with no
 *  gaps. Upper-layer clips are free-positioned and left untouched. */
export function reflowClips(project: EditorProject): EditorProject {
  let t = 0;
  const clips = project.clips.map(c => {
    if (clipTrack(c) !== BASE_TRACK) return c; // free layer keeps its position
    const placed = { ...c, timelineStart: t };
    t += clipLength(c);
    return placed;
  });
  return { ...project, clips };
}

/** Move a clip to another video track. To the upper layer: mute by default
 *  (keep base audio) and keep its free timeline position. To the base: re-flow
 *  it back into the gapless sequence. */
export function moveClipToTrack(project: EditorProject, clipId: string, track: number): EditorProject {
  const clip = project.clips.find(c => c.id === clipId);
  if (!clip || clipTrack(clip) === track) return project;
  const clips = project.clips.map(c => {
    if (c.id !== clipId) return c;
    const next: EditorClip = { ...c, track };
    if (track !== BASE_TRACK) next.muted = true; // upper layer silent by default
    return next;
  });
  return track === BASE_TRACK ? reflowClips({ ...project, clips }) : { ...project, clips };
}

/** Free horizontal move for an upper-layer clip (sets timelineStart directly). */
export function moveClipInTime(project: EditorProject, clipId: string, timelineStart: number): EditorProject {
  return {
    ...project,
    clips: project.clips.map(c => (c.id === clipId ? { ...c, timelineStart: Math.max(0, timelineStart) } : c)),
  };
}

export const MIN_CLIP = 0.1;
export const MIN_OVERLAY = 0.3;

export function updateClipById(project: EditorProject, clipId: string, patch: Partial<EditorClip>): EditorProject {
  return {
    ...project,
    clips: project.clips.map(c => {
      if (c.id !== clipId) return c;
      const next = { ...c, ...patch };
      if (patch.zoom !== undefined) next.zoom = Math.max(1, Math.min(4, patch.zoom));
      if (patch.panX !== undefined) next.panX = Math.max(0, Math.min(1, patch.panX));
      if (patch.panY !== undefined) next.panY = Math.max(0, Math.min(1, patch.panY));
      return next;
    }),
  };
}

/** Reset a clip's reframe to fit-inside, centered, no zoom. */
export function resetFraming(project: EditorProject, clipId: string): EditorProject {
  return updateClipById(project, clipId, { ...DEFAULT_FRAMING, ...DEFAULT_INSPECTOR });
}

/** Set every clip's fill mode at once (used by the aspect switcher / toolbar). */
export function setAllClipsFit(project: EditorProject, fit: 'contain' | 'cover'): EditorProject {
  return { ...project, clips: project.clips.map(c => ({ ...c, fit })) };
}

export function makeTextOverlay(start: number): EditorOverlay {
  return {
    id: crypto.randomUUID(), type: 'text',
    start, end: start + 5,
    x: 0.5, y: 0.85,
    text: 'New text', fontSize: 64, color: '#ffffff', bgColor: null,
  };
}

export function makeLowerThirdOverlay(start: number): EditorOverlay {
  return {
    id: crypto.randomUUID(), type: 'lowerThird',
    start, end: start + 5,
    x: 0.5, y: 0.85,
    title: 'Name', subtitle: 'Title or description',
    ltStyle: { ...DEFAULT_LOWER_THIRD_BLOCK_STYLE, shape: 'rounded' },
    animation: {
      in: { preset: 'slide-left', duration: 0.6, easing: 'easeOutCubic' },
      out: { preset: 'fade', duration: 0.4, easing: 'easeInOutCubic' },
    },
  };
}

export function makeImageOverlay(start: number, src: string): EditorOverlay {
  return {
    id: crypto.randomUUID(), type: 'image',
    start, end: start + 5,
    x: 0.5, y: 0.5, src, width: 0.3,
  };
}

export function addOverlay(project: EditorProject, overlay: EditorOverlay): EditorProject {
  return { ...project, overlays: [...project.overlays, overlay] };
}

export function updateOverlayById(project: EditorProject, id: string, patch: Partial<EditorOverlay>): EditorProject {
  return {
    ...project,
    overlays: project.overlays.map(o => {
      if (o.id !== id) return o;
      const next = { ...o, ...patch };
      // Keep a minimum visible window and non-negative start
      next.start = Math.max(0, next.start);
      next.end = Math.max(next.start + MIN_OVERLAY, next.end);
      // Keyframe times are relative to start. A trim (one edge patched, the
      // other not) re-anchors them so they hold their absolute timeline
      // position; a move (both edges patched together) carries them along.
      const leftTrim = patch.start !== undefined && patch.end === undefined;
      const rightTrim = patch.end !== undefined && patch.start === undefined;
      if ((leftTrim || rightTrim) && next.animation?.keyframes?.length) {
        const delta = leftTrim ? o.start - next.start : 0;
        next.animation = shiftKeyframes(next.animation, delta, next.end - next.start);
      }
      return next;
    }),
  };
}

export function removeOverlayById(project: EditorProject, id: string): EditorProject {
  return { ...project, overlays: project.overlays.filter(o => o.id !== id) };
}

export function overlaysAtTime(project: EditorProject, t: number): EditorOverlay[] {
  return project.overlays.filter(o => t >= o.start && t < o.end);
}

/** Retime one keyframe of an overlay (timeline diamond drag), clamped to the
 * overlay's window. */
export function retimeOverlayKeyframe(
  project: EditorProject, overlayId: string, index: number, localT: number,
): EditorProject {
  const o = project.overlays.find(ov => ov.id === overlayId);
  if (!o?.animation?.keyframes?.[index]) return project;
  const t = Math.max(0, Math.min(o.end - o.start, localT));
  return updateOverlayById(project, overlayId, {
    animation: retimeAnimKeyframe(o.animation, index, t),
  });
}

export function makeAudioClip(assetId: string, name: string, sourceDuration: number, start: number): EditorAudioClip {
  return {
    id: crypto.randomUUID(), assetId, name, sourceDuration,
    inPoint: 0, outPoint: sourceDuration || 0, timelineStart: Math.max(0, start),
    volume: 1, muted: false, fadeIn: 0, fadeOut: 0,
  };
}

export function addAudioClip(project: EditorProject, a: EditorAudioClip): EditorProject {
  return { ...project, audioClips: [...(project.audioClips ?? []), a] };
}

export function updateAudioClipById(project: EditorProject, id: string, patch: Partial<EditorAudioClip>): EditorProject {
  return {
    ...project,
    audioClips: (project.audioClips ?? []).map(a => {
      if (a.id !== id) return a;
      const next = { ...a, ...patch };
      next.inPoint = Math.max(0, Math.min(next.inPoint, next.outPoint - MIN_CLIP));
      next.outPoint = Math.min(next.sourceDuration || next.outPoint, Math.max(next.outPoint, next.inPoint + MIN_CLIP));
      next.timelineStart = Math.max(0, next.timelineStart);
      return next;
    }),
  };
}

export function removeAudioClipById(project: EditorProject, id: string): EditorProject {
  return { ...project, audioClips: (project.audioClips ?? []).filter(a => a.id !== id) };
}


/** Trim a clip's in/out points (clamped), then re-flow the track gapless. */
export function setClipTrim(
  project: EditorProject,
  clipId: string,
  patch: { inPoint?: number; outPoint?: number },
): EditorProject {
  let isUpper = false;
  const clips = project.clips.map(c => {
    if (c.id !== clipId) return c;
    isUpper = clipTrack(c) !== BASE_TRACK;
    const oldIn = c.inPoint;
    let inP = patch.inPoint ?? c.inPoint;
    let outP = patch.outPoint ?? c.outPoint;
    const maxOut = c.sourceDuration || outP;
    inP = Math.max(0, Math.min(inP, outP - MIN_CLIP));
    outP = Math.min(maxOut, Math.max(outP, inP + MIN_CLIP));
    const next = { ...c, inPoint: inP, outPoint: outP };
    // Free (upper) clip: trimming the left edge keeps the right edge fixed by
    // shifting timelineStart (base clips are re-flowed instead, below).
    if (isUpper && patch.inPoint !== undefined) {
      next.timelineStart = Math.max(0, c.timelineStart + (inP - oldIn) / (c.speed || 1));
    }
    return next;
  });
  // Only the base track re-flows; upper-layer trims stay where the user put them.
  return isUpper ? { ...project, clips } : reflowClips({ ...project, clips });
}

/** Split a clip at a timeline time into two adjacent clips. */
export function splitClip(project: EditorProject, clipId: string, timelineTime: number): EditorProject {
  const idx = project.clips.findIndex(c => c.id === clipId);
  if (idx < 0) return project;
  const clip = project.clips[idx];
  const srcT = sourceTimeFor(clip, timelineTime);
  if (srcT <= clip.inPoint + MIN_CLIP || srcT >= clip.outPoint - MIN_CLIP) return project;
  const isUpper = clipTrack(clip) !== BASE_TRACK;
  const left: EditorClip = { ...clip, outPoint: srcT };
  const right: EditorClip = { ...clip, id: crypto.randomUUID(), inPoint: srcT };
  // Free (upper) clip: the right half starts at the cut time; no re-flow.
  if (isUpper) right.timelineStart = timelineTime;
  const clips = [...project.clips.slice(0, idx), left, right, ...project.clips.slice(idx + 1)];
  return isUpper ? { ...project, clips } : reflowClips({ ...project, clips });
}

/** Split an audio clip at a timeline time into two adjacent clips. */
export function splitAudioClip(project: EditorProject, audioId: string, timelineTime: number): EditorProject {
  const audioClips = project.audioClips ?? [];
  const idx = audioClips.findIndex(a => a.id === audioId);
  if (idx < 0) return project;
  const a = audioClips[idx];
  // Audio has no speed; source time advances 1:1 with the timeline.
  const srcT = a.inPoint + (timelineTime - a.timelineStart);
  if (srcT <= a.inPoint + MIN_CLIP || srcT >= a.outPoint - MIN_CLIP) return project;
  const left: EditorAudioClip = { ...a, outPoint: srcT, fadeOut: 0 };
  const right: EditorAudioClip = {
    ...a, id: crypto.randomUUID(), inPoint: srcT, timelineStart: timelineTime, fadeIn: 0,
  };
  const next = [...audioClips.slice(0, idx), left, right, ...audioClips.slice(idx + 1)];
  return { ...project, audioClips: next };
}

/** Split an overlay (text/image) at a timeline time into two adjacent overlays. */
export function splitOverlay(project: EditorProject, overlayId: string, timelineTime: number): EditorProject {
  const idx = project.overlays.findIndex(o => o.id === overlayId);
  if (idx < 0) return project;
  const o = project.overlays[idx];
  if (timelineTime <= o.start + MIN_CLIP || timelineTime >= o.end - MIN_CLIP) return project;
  // Drop the exit anim from the left half and the entrance from the right so
  // the split point doesn't replay in/out motion mid-overlay.
  let leftAnim = o.animation ? { ...o.animation, out: undefined } : undefined;
  let rightAnim = o.animation ? { ...o.animation, in: undefined } : undefined;
  // Keyframes: each half keeps its own (right half re-based to its new start),
  // with the value sampled at the cut pinned on both sides so neither jumps.
  if (o.animation?.keyframes?.length) {
    const cut = timelineTime - o.start;
    const base: AnimatableProps = {
      x: o.x, y: o.y, scale: o.scale ?? 1, opacity: o.opacity ?? 1, rotation: 0,
    };
    const pin = sampleKeyframeProps(base, o.animation.keyframes, cut);
    leftAnim = {
      ...leftAnim,
      keyframes: [
        ...o.animation.keyframes.filter(k => k.t < cut - 1e-9),
        { t: cut, props: pin },
      ],
    };
    rightAnim = {
      ...rightAnim,
      keyframes: [
        { t: 0, props: pin },
        ...o.animation.keyframes.filter(k => k.t > cut + 1e-9).map(k => ({ ...k, t: k.t - cut })),
      ],
    };
  }
  const left: EditorOverlay = { ...o, end: timelineTime, animation: leftAnim };
  const right: EditorOverlay = { ...o, id: crypto.randomUUID(), start: timelineTime, animation: rightAnim };
  const overlays = [...project.overlays.slice(0, idx), left, right, ...project.overlays.slice(idx + 1)];
  return { ...project, overlays };
}

/** Razor: split every clip, audio clip, and overlay crossing a timeline time. */
export function splitAllAt(project: EditorProject, timelineTime: number): EditorProject {
  let next = project;
  // Split every video clip crossing this time (all layers), not just the top one.
  for (const id of clipsAtTime(next, timelineTime).map(c => c.id)) next = splitClip(next, id, timelineTime);
  for (const a of audioClipsAtTime(next, timelineTime)) next = splitAudioClip(next, a.id, timelineTime);
  for (const o of overlaysAtTime(next, timelineTime)) next = splitOverlay(next, o.id, timelineTime);
  return next;
}

/** Reorder a BASE-track clip to the sequence position under `pointerSec`
 *  (dropping when the pointer passes each neighbor's midpoint), preserving
 *  upper-layer clips, then re-flow the base track gapless. */
export function reorderBaseClipTo(project: EditorProject, clipId: string, pointerSec: number): EditorProject {
  const clip = project.clips.find(c => c.id === clipId);
  if (!clip || clipTrack(clip) !== BASE_TRACK) return project;
  const others = project.clips.filter(c => clipTrack(c) === BASE_TRACK && c.id !== clipId);
  let acc = 0;
  let idx = 0;
  for (const c of others) {
    if (pointerSec < acc + clipLength(c) / 2) break;
    acc += clipLength(c);
    idx++;
  }
  const base = [...others.slice(0, idx), clip, ...others.slice(idx)];
  const upper = project.clips.filter(c => clipTrack(c) !== BASE_TRACK);
  return reflowClips({ ...project, clips: [...base, ...upper] });
}

/** Move a clip to a new index in the track order, then re-flow gapless. */
export function reorderToIndex(project: EditorProject, clipId: string, newIndex: number): EditorProject {
  const from = project.clips.findIndex(c => c.id === clipId);
  if (from < 0) return project;
  const clips = [...project.clips];
  const [item] = clips.splice(from, 1);
  const idx = Math.max(0, Math.min(newIndex, clips.length));
  clips.splice(idx, 0, item);
  return reflowClips({ ...project, clips });
}

export function formatTimecode(seconds: number, fps = EDITOR_FPS): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s - Math.floor(s)) * fps);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}
