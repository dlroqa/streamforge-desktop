import type { VideoFilter, LowerThird, Poll, Question, LogoOverlay } from '@/contexts/StudioContext';
import { drawLowerThirdBlock, hexToRgba, roundRectPath, truncate } from '@/lib/lowerThird';
import { LutRenderer, type ParsedLut } from '@/lib/lut';

export { hexToRgba } from '@/lib/lowerThird';
import { AudioEffectsRack, AUDIO_EFFECTS_NEUTRAL, type AudioEffectsSettings } from '@/lib/audioEffects';

// CSS filter strings shared by the preview <video> elements and the
// broadcast compositor so both always render identically.
export const FILTER_CSS: Record<VideoFilter, string> = {
  none: '',
  grayscale: 'grayscale(100%)',
  sepia: 'sepia(80%)',
  contrast: 'contrast(150%) brightness(110%)',
  warm: 'sepia(30%) saturate(140%) brightness(105%)',
  cool: 'hue-rotate(30deg) saturate(120%)',
  vintage: 'sepia(50%) contrast(90%) brightness(90%)',
  dramatic: 'contrast(170%) brightness(80%) saturate(130%)',
};

/** Custom color-correction applied on top of the preset filter.
 * Neutral values produce no change. */
export interface ColorGrade {
  gamma: number;       // 0.2–2.5, neutral 1
  brightness: number;  // 0–200 (%), neutral 100
  contrast: number;    // 0–200 (%), neutral 100
  saturation: number;  // 0–200 (%), neutral 100
  hue: number;         // -180–180 (deg), neutral 0
  opacity: number;     // 0–100 (%), neutral 100
  multiplyEnabled: boolean;
  multiplyColor: string; // hex
  addEnabled: boolean;
  addColor: string;      // hex
}

export const NEUTRAL_GRADE: ColorGrade = {
  gamma: 1,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  opacity: 100,
  multiplyEnabled: false,
  multiplyColor: '#ffffff',
  addEnabled: false,
  addColor: '#000000',
};

/** PiP tile top-left as a fraction of the scene (0,0 = top-left corner).
 * Shared by the preview and the compositor so both place PiP identically. */
export interface PipPosition {
  x: number;
  y: number;
}

/** Default PiP anchor — upper-right, matching the historical fixed position. */
export const PIP_DEFAULT_POSITION: PipPosition = { x: 0.76, y: 0.04 };

/** Tile size as a fraction of scene width (height follows 16:9). */
export const PIP_WIDTH_FRAC = 0.22;

/** 4-band broadcast mic EQ; gains in dB (−12…+12), neutral = flat zeros. */
export interface EqGains {
  subBass: number;
  bass: number;
  mid: number;
  treble: number;
}

export const EQ_NEUTRAL: EqGains = { subBass: 0, bass: 0, mid: 0, treble: 0 };

/** Band layout shared by the broadcast chain and the panel's spectrum
 * visualizer, so what you see is what the mix does. */
export const EQ_BANDS: {
  key: keyof EqGains;
  label: string;
  range: string;
  type: BiquadFilterType;
  frequency: number;
  q?: number;
}[] = [
  { key: 'subBass', label: 'Sub-bass', range: '20–60 Hz', type: 'lowshelf', frequency: 60 },
  { key: 'bass', label: 'Bass', range: '60–250 Hz', type: 'peaking', frequency: 150, q: 0.9 },
  { key: 'mid', label: 'Midrange', range: '250–4k Hz', type: 'peaking', frequency: 1200, q: 0.7 },
  { key: 'treble', label: 'Treble', range: '4–16 kHz', type: 'highshelf', frequency: 6000 },
];

/** Create the EQ biquad filters wired in series (order matches EQ_BANDS).
 * Connect audio into nodes[0] and take output from nodes[nodes.length-1]. */
export function createEqChain(ctx: BaseAudioContext): BiquadFilterNode[] {
  const nodes = EQ_BANDS.map(band => {
    const f = ctx.createBiquadFilter();
    f.type = band.type;
    f.frequency.value = band.frequency;
    if (band.q !== undefined) f.Q.value = band.q;
    f.gain.value = 0;
    return f;
  });
  for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]);
  return nodes;
}

/** Apply band gains to a chain built by createEqChain (smooth, click-free). */
export function applyEqGains(nodes: BiquadFilterNode[], eq: EqGains, ctx: BaseAudioContext) {
  EQ_BANDS.forEach((band, i) => {
    const db = Math.max(-12, Math.min(12, eq[band.key] ?? 0));
    nodes[i].gain.setTargetAtTime(db, ctx.currentTime, 0.05);
  });
}

/** DOM id of the SVG gamma filter (rendered by GammaFilterDef). Referenced by
 * both the preview's CSS filter and the compositor's ctx.filter so the two
 * can never diverge. */
export const GAMMA_FILTER_ID = 'studio-gamma-filter';

/** Build the combined CSS/canvas filter string: preset first, then custom
 * adjustments, gamma last (via SVG reference filter — CSS has no gamma fn). */
export function buildFilterCss(preset: VideoFilter, grade: ColorGrade): string {
  const parts: string[] = [];
  const presetCss = FILTER_CSS[preset];
  if (presetCss) parts.push(presetCss);
  if (grade.brightness !== 100) parts.push(`brightness(${grade.brightness}%)`);
  if (grade.contrast !== 100) parts.push(`contrast(${grade.contrast}%)`);
  if (grade.saturation !== 100) parts.push(`saturate(${grade.saturation}%)`);
  if (grade.hue !== 0) parts.push(`hue-rotate(${grade.hue}deg)`);
  if (grade.opacity !== 100) parts.push(`opacity(${grade.opacity}%)`);
  if (grade.gamma !== 1) parts.push(`url(#${GAMMA_FILTER_ID})`);
  return parts.join(' ');
}

export interface CompositorGuest {
  sessionId: string;
  userName: string;
  videoTrack: MediaStreamTrack | null;
}

/** How the host + guests are arranged once at least one guest is on stage:
 * - split: equal side-by-side / grid, everyone crop-filled to match
 * - pip:   host full-frame, guests as stacked picture-in-picture tiles
 * - solo:  host full-frame only (guests stay audible, hidden from video) */
export type GuestLayout = 'split' | 'pip' | 'solo';

/** Which source the Scenes switcher has cut to the program bus. `'auto'` keeps
 * the historical priority pick (media > screen > camera1 > camera2); the
 * others force a specific host source on air regardless of that priority. */
export type ProgramSource = 'auto' | 'camera1' | 'camera2' | 'screen' | 'media';

/** Scene-switch transition rendered inside the compositor so it reaches the
 * broadcast (not just the local preview). */
export type TransitionType = 'instant' | 'crossfade' | 'slide';

export interface CompositorInputs {
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  camera2Stream: MediaStream | null;
  /** Pre-recorded media playback (scheduled/rebroadcast streams). Takes
   * priority as the main source; its audio joins the broadcast mix. */
  mediaStream: MediaStream | null;
  /** Hide the camera PiP while a media source is the main feed, for a clean
   * full-frame excerpt. */
  mediaHideCamera: boolean;
  isCameraOn: boolean;
  isCamera2On: boolean;
  isScreenSharing: boolean;
  filter: VideoFilter;
  grade: ColorGrade;
  /** 3D LUT applied to the main video source (WebGL stage) */
  lut: ParsedLut | null;
  /** Additional microphone sources, each with its own gain (0–100) */
  extraAudio: Array<{ id: string; stream: MediaStream; volume: number }>;
  /** Uploaded logo/watermark (image or looping video) */
  logo: LogoOverlay | null;
  lowerThird: LowerThird;
  activePoll: Poll | null;
  highlightedQuestion: Question | null;
  /** Master mic volume 0–100 (studio volume slider). */
  volume: number;
  /** 4-band EQ applied to the primary broadcast mic. */
  eq: EqGains;
  /** VST-style effects rack applied to the primary broadcast mic (after EQ). */
  audioEffects: AudioEffectsSettings;
  /** Where PiP camera tiles anchor (draggable). */
  pipPosition: PipPosition;
  /** Remote guests to composite alongside the host scene.
   * Guest AUDIO is intentionally NOT mixed here: the RTMP output uses a VCS
   * layout that muxes all participants' audio server-side, and mixing guests
   * into the host's published track would echo their own voice back at them. */
  guests: CompositorGuest[];
  /** Host-chosen arrangement for host + guests (default 'split'). */
  guestLayout: GuestLayout;
  /** Scenes switcher: which host source is cut to the program bus. */
  program: ProgramSource;
  /** Scenes switcher: when set, this guest is featured full-frame (host and any
   * other guests become picture-in-picture inserts), overriding `guestLayout`. */
  featuredGuestId: string | null;
}

const W = 1280;
const H = 720;
const FPS = 30;

// Night-theme palette approximations (canvas needs concrete colors,
// not CSS variables). Keep in sync with src/index.css :root values.
const COLORS = {
  background: '#0d0f17',   // --background 225 25% 7%
  card: 'rgba(22, 25, 38, 0.95)',        // --card 225 20% 11%
  border: 'rgba(120, 130, 160, 0.25)',
  foreground: '#e4e8ef',   // --foreground
  muted: '#737e96',        // --muted-foreground
  primary: '#06b4e0',      // --primary 192 95% 45%
  primaryBg: 'rgba(6, 180, 224, 0.95)',
  onPrimary: '#0d0f17',
  accent: '#f99e1f',       // --accent 35 95% 55%
  track: 'rgba(120, 130, 160, 0.25)',
};

const FONT = 'Inter, system-ui, sans-serif';

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) {
        // Last allowed line — truncate the rest
        const rest = [word, ...words.slice(words.indexOf(word) + 1)].join(' ');
        lines.push(truncate(ctx, rest, maxWidth));
        return lines;
      }
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function hasLiveVideo(video: HTMLVideoElement): boolean {
  return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0;
}

/**
 * Composites the studio scene (sources, filter, overlays) onto a canvas and
 * mixes audio through WebAudio, producing the single MediaStream that is
 * actually broadcast. This is the "what you see is what viewers get" layer:
 * the DOM preview and this compositor render from the same state.
 */
export class StreamCompositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cameraVideo: HTMLVideoElement;
  private camera2Video: HTMLVideoElement;
  private screenVideo: HTMLVideoElement;
  private mediaVideo: HTMLVideoElement;
  private guestVideos = new Map<string, { video: HTMLVideoElement; track: MediaStreamTrack | null }>();
  private inputs: CompositorInputs;
  private drawTimer: ReturnType<typeof setInterval> | null = null;
  private lutRenderer: LutRenderer | null = null;
  private lutRendererFailed = false;
  private filterStage: HTMLCanvasElement | null = null;
  private appliedLut: ParsedLut | null = null;
  private logoEl: HTMLImageElement | HTMLVideoElement | null = null;
  private logoUrl: string | null = null;

  private audioCtx: AudioContext;
  private audioDest: MediaStreamAudioDestinationNode;
  private micGain: GainNode;
  private micEq: BiquadFilterNode[];
  private micFx: AudioEffectsRack;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private screenAudioSource: MediaStreamAudioSourceNode | null = null;
  private screenAudioStream: MediaStream | null = null;
  private mediaAudioSource: MediaStreamAudioSourceNode | null = null;
  private mediaAudioStream: MediaStream | null = null;
  private extraAudio = new Map<string, {
    stream: MediaStream;
    source: MediaStreamAudioSourceNode;
    gain: GainNode;
  }>();

  private outputStream: MediaStream | null = null;
  /** Canvas scale factor relative to the 1280x720 design coordinate system.
   * Drawing code stays in design coords; the transform renders them at the
   * chosen output resolution, so video and text remain sharp. */
  private scale: number;
  private orientation: 'landscape' | 'portrait';
  /** Design-space dimensions (orientation-dependent) */
  private dw: number;
  private dh: number;

  constructor(outputHeight: 720 | 1080 = 720, orientation: 'landscape' | 'portrait' = 'landscape') {
    this.orientation = orientation;
    // Design space: 1280x720 landscape, 720x1280 portrait; outputHeight is
    // the SHORT side (720 or 1080), so scale = short/720 in both cases.
    this.dw = orientation === 'portrait' ? H : W;
    this.dh = orientation === 'portrait' ? W : H;
    this.scale = outputHeight / H;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(this.dw * this.scale);
    this.canvas.height = Math.round(this.dh * this.scale);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;

    this.cameraVideo = StreamCompositor.createVideoElement();
    this.camera2Video = StreamCompositor.createVideoElement();
    this.screenVideo = StreamCompositor.createVideoElement();
    this.mediaVideo = StreamCompositor.createVideoElement();

    this.audioCtx = new AudioContext();
    this.audioDest = this.audioCtx.createMediaStreamDestination();
    this.micGain = this.audioCtx.createGain();
    this.micGain.connect(this.audioDest);
    // Primary mic strip: mic → EQ → FX rack → master gain → mix
    this.micEq = createEqChain(this.audioCtx);
    this.micFx = new AudioEffectsRack(this.audioCtx);
    this.micEq[this.micEq.length - 1].connect(this.micFx.input);
    this.micFx.output.connect(this.micGain);

    this.inputs = {
      cameraStream: null,
      screenStream: null,
      camera2Stream: null,
      mediaStream: null,
      mediaHideCamera: false,
      isCameraOn: false,
      isCamera2On: false,
      isScreenSharing: false,
      filter: 'none',
      grade: NEUTRAL_GRADE,
      lut: null,
      logo: null,
      extraAudio: [],
      audioEffects: AUDIO_EFFECTS_NEUTRAL,
      lowerThird: {
        title: '', subtitle: '', visible: false,
        // Literal default (not imported from StudioContext to avoid a
        // runtime import cycle); always replaced by update() before use.
        style: {
          bgColor: '#06b4e0', textColor: '#ffffff', accentColor: '#f99e1f',
          titleSize: 28, subtitleSize: 19, font: 'inter', shape: 'none',
          align: 'left', bold: true, italic: false, underline: false,
          x: 0.5, y: 0.88,
        },
      },
      activePoll: null,
      highlightedQuestion: null,
      volume: 75,
      eq: EQ_NEUTRAL,
      pipPosition: PIP_DEFAULT_POSITION,
      guests: [],
      guestLayout: 'split',
      program: 'auto',
      featuredGuestId: null,
    };
  }

  // ── Scene-switch transition ──
  /** Frozen copy of the frame at the moment of the last non-instant switch. */
  private fromCanvas: HTMLCanvasElement | null = null;
  private transitionKind: TransitionType = 'instant';
  private transitionStart = 0;
  /** Transition duration in ms (kept short so the program is never ambiguous). */
  private static readonly TRANSITION_MS = 450;

  /** Kick off a scene-switch transition. Instant is a no-op (hard cut). For
   * cross-fade / slide we snapshot the current frame; `draw()` then overlays
   * that frozen frame over the freshly-composited one for TRANSITION_MS. */
  beginTransition(kind: TransitionType) {
    if (kind === 'instant') { this.transitionKind = 'instant'; return; }
    if (!this.fromCanvas) {
      this.fromCanvas = document.createElement('canvas');
    }
    this.fromCanvas.width = this.canvas.width;
    this.fromCanvas.height = this.canvas.height;
    const fctx = this.fromCanvas.getContext('2d');
    if (!fctx) { this.transitionKind = 'instant'; return; }
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, this.fromCanvas.width, this.fromCanvas.height);
    fctx.drawImage(this.canvas, 0, 0);
    this.transitionKind = kind;
    this.transitionStart = performance.now();
  }

  /** Overlay the frozen previous frame over the current one while a transition
   * is running. Runs in device pixels (identity transform). */
  private drawTransition() {
    if (this.transitionKind === 'instant' || !this.fromCanvas) return;
    const elapsed = performance.now() - this.transitionStart;
    const raw = elapsed / StreamCompositor.TRANSITION_MS;
    if (raw >= 1) { this.transitionKind = 'instant'; return; }
    // easeInOutQuad
    const p = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    if (this.transitionKind === 'crossfade') {
      ctx.globalAlpha = 1 - p;
      ctx.drawImage(this.fromCanvas, 0, 0);
    } else {
      // slide: the old frame slides out to the left, revealing the new one.
      ctx.drawImage(this.fromCanvas, -p * this.canvas.width, 0);
    }
    ctx.restore();
  }

  private static createVideoElement(): HTMLVideoElement {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    return video;
  }

  update(inputs: CompositorInputs) {
    this.inputs = inputs;
    this.attachVideo(this.cameraVideo, inputs.cameraStream);
    this.attachVideo(this.camera2Video, inputs.camera2Stream);
    this.attachVideo(this.screenVideo, inputs.screenStream);
    this.attachVideo(this.mediaVideo, inputs.mediaStream);
    this.reconcileGuestVideos(inputs.guests);
    this.syncLogo(inputs.logo);
    this.syncAudio(inputs);
  }

  private syncLogo(logo: LogoOverlay | null) {
    if (!logo) {
      if (this.logoEl instanceof HTMLVideoElement) this.logoEl.pause();
      this.logoEl = null;
      this.logoUrl = null;
      return;
    }
    if (this.logoUrl === logo.url) return;
    if (this.logoEl instanceof HTMLVideoElement) this.logoEl.pause();
    this.logoUrl = logo.url;
    if (logo.kind === 'video') {
      const video = document.createElement('video');
      video.src = logo.url;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.play().catch(() => { /* draw loop tolerates missing frames */ });
      this.logoEl = video;
    } else {
      const img = new Image();
      img.src = logo.url;
      this.logoEl = img;
    }
  }

  private reconcileGuestVideos(guests: CompositorGuest[]) {
    const seen = new Set<string>();
    for (const guest of guests) {
      seen.add(guest.sessionId);
      const existing = this.guestVideos.get(guest.sessionId);
      if (!existing) {
        const video = StreamCompositor.createVideoElement();
        if (guest.videoTrack) {
          video.srcObject = new MediaStream([guest.videoTrack]);
          video.play().catch(() => { /* draw loop tolerates missing frames */ });
        }
        this.guestVideos.set(guest.sessionId, { video, track: guest.videoTrack });
      } else if (existing.track !== guest.videoTrack) {
        existing.track = guest.videoTrack;
        existing.video.srcObject = guest.videoTrack ? new MediaStream([guest.videoTrack]) : null;
        if (guest.videoTrack) existing.video.play().catch(() => { /* ditto */ });
      }
    }
    for (const [sessionId, entry] of this.guestVideos) {
      if (!seen.has(sessionId)) {
        entry.video.srcObject = null;
        this.guestVideos.delete(sessionId);
      }
    }
  }

  private attachVideo(video: HTMLVideoElement, stream: MediaStream | null) {
    if (video.srcObject === stream) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => { /* draw loop tolerates missing frames */ });
  }

  private syncAudio(inputs: CompositorInputs) {
    // Mic (from camera stream)
    if (this.micStream !== inputs.cameraStream) {
      this.micSource?.disconnect();
      this.micSource = null;
      this.micStream = inputs.cameraStream;
      if (inputs.cameraStream?.getAudioTracks().length) {
        this.micSource = this.audioCtx.createMediaStreamSource(inputs.cameraStream);
        this.micSource.connect(this.micEq[0]);
      }
    }
    // Media playback audio (recordings streamed as source)
    if (this.mediaAudioStream !== inputs.mediaStream) {
      this.mediaAudioSource?.disconnect();
      this.mediaAudioSource = null;
      this.mediaAudioStream = inputs.mediaStream;
      if (inputs.mediaStream?.getAudioTracks().length) {
        this.mediaAudioSource = this.audioCtx.createMediaStreamSource(inputs.mediaStream);
        this.mediaAudioSource.connect(this.audioDest);
      }
    }
    // Screen audio (present only if the capture included audio)
    if (this.screenAudioStream !== inputs.screenStream) {
      this.screenAudioSource?.disconnect();
      this.screenAudioSource = null;
      this.screenAudioStream = inputs.screenStream;
      if (inputs.screenStream?.getAudioTracks().length) {
        this.screenAudioSource = this.audioCtx.createMediaStreamSource(inputs.screenStream);
        this.screenAudioSource.connect(this.audioDest);
      }
    }
    // Additional mics: reconcile per-source gain chains
    const seen = new Set<string>();
    for (const mic of inputs.extraAudio) {
      seen.add(mic.id);
      let entry = this.extraAudio.get(mic.id);
      if (entry && entry.stream !== mic.stream) {
        entry.source.disconnect();
        entry.gain.disconnect();
        this.extraAudio.delete(mic.id);
        entry = undefined;
      }
      if (!entry && mic.stream.getAudioTracks().length) {
        const source = this.audioCtx.createMediaStreamSource(mic.stream);
        const gain = this.audioCtx.createGain();
        source.connect(gain);
        gain.connect(this.audioDest);
        entry = { stream: mic.stream, source, gain };
        this.extraAudio.set(mic.id, entry);
      }
      entry?.gain.gain.setTargetAtTime(
        Math.max(0, Math.min(1, mic.volume / 100)),
        this.audioCtx.currentTime,
        0.05,
      );
    }
    for (const [id, entry] of this.extraAudio) {
      if (!seen.has(id)) {
        entry.source.disconnect();
        entry.gain.disconnect();
        this.extraAudio.delete(id);
      }
    }

    // Master mic volume (0–100); smooth ramp avoids clicks
    const gain = Math.max(0, Math.min(1, inputs.volume / 100));
    this.micGain.gain.setTargetAtTime(gain, this.audioCtx.currentTime, 0.05);
    applyEqGains(this.micEq, inputs.eq, this.audioCtx);
    this.micFx.apply(inputs.audioEffects);
  }

  async start(): Promise<MediaStream> {
    if (this.outputStream) return this.outputStream;
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume().catch(() => { /* mixed silently if resume fails */ });
    }
    this.draw();
    const canvasStream = this.canvas.captureStream(FPS);
    this.outputStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...this.audioDest.stream.getAudioTracks(),
    ]);
    // setInterval (not rAF): rAF pauses in background tabs, which would
    // freeze the broadcast. Pages with live WebRTC are exempt from
    // aggressive timer throttling.
    this.drawTimer = setInterval(() => this.draw(), 1000 / FPS);
    return this.outputStream;
  }

  /** The running composite (LUT + filter + overlays + audio mix), or null if
   *  the compositor hasn't been started. Lets a recorder capture the exact
   *  graded frames the broadcast sends. */
  getOutputStream(): MediaStream | null {
    return this.outputStream;
  }

  stop() {
    if (this.drawTimer) {
      clearInterval(this.drawTimer);
      this.drawTimer = null;
    }
    this.outputStream?.getTracks().forEach(t => t.stop());
    this.outputStream = null;
    this.micSource?.disconnect();
    this.screenAudioSource?.disconnect();
    this.mediaAudioSource?.disconnect();
    for (const entry of this.extraAudio.values()) {
      entry.source.disconnect();
      entry.gain.disconnect();
    }
    this.extraAudio.clear();
    this.micFx.disconnect();
    this.audioCtx.close().catch(() => { /* already closed */ });
    this.cameraVideo.srcObject = null;
    this.camera2Video.srcObject = null;
    this.screenVideo.srcObject = null;
    this.mediaVideo.srcObject = null;
    for (const entry of this.guestVideos.values()) {
      entry.video.srcObject = null;
    }
    this.guestVideos.clear();
    this.lutRenderer?.dispose();
    this.lutRenderer = null;
    this.appliedLut = null;
    if (this.logoEl instanceof HTMLVideoElement) this.logoEl.pause();
    this.logoEl = null;
    this.logoUrl = null;
  }

  // ── Drawing ──

  private draw() {
    const { ctx, inputs } = this;
    // Render 720p design coordinates at the output resolution
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.filter = 'none';
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.dw, this.dh);

    // Scenes switcher can cut a specific guest to the program: feature them
    // full-frame with everyone else (host + other guests) as PiP inserts. We
    // reorder so the featured guest is first, then run the pip layout below.
    const featured = inputs.featuredGuestId
      ? inputs.guests.find(g => g.sessionId === inputs.featuredGuestId) ?? null
      : null;
    const guests = featured
      ? [featured, ...inputs.guests.filter(g => g !== featured)]
      : inputs.guests;
    const layout: GuestLayout = featured ? 'pip' : (inputs.guestLayout ?? 'split');

    if (guests.length === 0 || layout === 'solo') {
      // Host only, full frame (guests, if any, stay audible via the audio mux)
      this.drawHostScene(0, 0, this.dw, this.dh);
    } else if (layout === 'pip') {
      // Featured guest full-frame + the host (and any other guests) as stacked
      // picture-in-picture insets.
      this.drawGuestTile(guests[0], 0, 0, this.dw, this.dh, 0);
      this.drawPipInserts(guests.slice(1));
    } else {
      // split: 16:9 tiles (matching the guest studio's aspect-video tiles),
      // host first then guests, centered as a grid — so each source keeps its
      // broadcast framing instead of being stretched to full height.
      const tiles = 1 + guests.length;
      const cols = tiles <= 2 ? 2 : tiles <= 4 ? 2 : 3;
      const rows = Math.ceil(tiles / cols);
      const gap = 8;
      // Fit each cell to a 16:9 tile within the available grid area.
      const availW = (this.dw - gap * (cols + 1)) / cols;
      const availH = (this.dh - gap * (rows + 1)) / rows;
      const tileW = Math.min(availW, availH * 16 / 9);
      const tileH = tileW * 9 / 16;
      // Center the whole grid block on the canvas.
      const gridW = cols * tileW + gap * (cols - 1);
      const gridH = rows * tileH + gap * (rows - 1);
      const originX = (this.dw - gridW) / 2;
      const originY = (this.dh - gridH) / 2;

      for (let i = 0; i < tiles; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        // Center the last row when it isn't full
        const inLastRow = row === rows - 1;
        const lastRowCount = tiles - (rows - 1) * cols;
        const rowOffset = inLastRow && lastRowCount < cols
          ? ((cols - lastRowCount) * (tileW + gap)) / 2
          : 0;
        const x = originX + col * (tileW + gap) + rowOffset;
        const y = originY + row * (tileH + gap);

        if (i === 0) {
          // Host tile: rounded like the guest tiles, cover-filled (16:9 tile +
          // 16:9 source = exact fit, no crop).
          const { ctx } = this;
          ctx.save();
          roundRectPath(ctx, x, y, tileW, tileH, 10);
          ctx.clip();
          this.drawHostScene(x, y, tileW, tileH, 'cover');
          ctx.restore();
        } else {
          this.drawGuestTile(guests[i - 1], x, y, tileW, tileH);
        }
      }
    }

    this.drawLogo();
    if (inputs.lowerThird.visible && inputs.lowerThird.title) this.drawLowerThird();
    if (inputs.activePoll) this.drawPoll(inputs.activePoll);
    if (inputs.highlightedQuestion) this.drawQuestion(inputs.highlightedQuestion);

    // Scene-switch transition rides on top of the finished frame so viewers
    // see the fade/slide (it's baked into the captured canvas stream).
    this.drawTransition();
  }

  /** Logo/watermark: above the scene, below the text overlays. */
  private drawLogo() {
    const logo = this.inputs.logo;
    const el = this.logoEl;
    if (!logo?.visible || !el) return;
    const nw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const nh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    if (!nw || !nh) return; // not loaded yet

    const w = Math.max(8, logo.scale * this.dw);
    const h = w * (nh / nw);
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, logo.opacity / 100));
    ctx.drawImage(el, logo.x * this.dw - w / 2, logo.y * this.dh - h / 2, w, h);
    ctx.restore();
  }

  /** The host's own scene (screen/cameras + PiPs), rendered into a rect.
   * fillMode 'cover' crop-fills the main source (used for split-grid tiles so
   * the host matches the guests); 'contain' letterboxes (full-frame default). */
  private drawHostScene(x: number, y: number, w: number, h: number, fillMode: 'contain' | 'cover' = 'contain') {
    const { ctx, inputs } = this;
    const mediaReady = !!inputs.mediaStream && hasLiveVideo(this.mediaVideo);
    const screenReady = inputs.isScreenSharing && hasLiveVideo(this.screenVideo);
    const cameraReady = inputs.isCameraOn && hasLiveVideo(this.cameraVideo);
    const camera2Ready = inputs.isCamera2On && hasLiveVideo(this.camera2Video);
    const filterCss = buildFilterCss(inputs.filter, inputs.grade) || 'none';

    // Main source: the Scenes switcher can force a specific source on air
    // (program !== 'auto'); otherwise fall back to the historical priority
    // media playback > screen > camera 1 > camera 2. Remaining live cameras
    // render as stacked picture-in-picture tiles either way.
    const program = inputs.program ?? 'auto';
    let main: HTMLVideoElement | null;
    if (program === 'camera1') main = cameraReady ? this.cameraVideo : null;
    else if (program === 'camera2') main = camera2Ready ? this.camera2Video : null;
    else if (program === 'screen') main = screenReady ? this.screenVideo : null;
    else if (program === 'media') main = mediaReady ? this.mediaVideo : null;
    else {
      main = mediaReady
        ? this.mediaVideo
        : screenReady ? this.screenVideo : cameraReady ? this.cameraVideo : camera2Ready ? this.camera2Video : null;
    }

    if (!main) {
      this.drawPlaceholder(x, y, w, h);
      return;
    }

    // LUT stage: run the main frame through WebGL before compositing
    let mainSource: HTMLVideoElement | HTMLCanvasElement = main;
    const srcW = main.videoWidth;
    const srcH = main.videoHeight;
    if (inputs.lut && this.ensureLut(inputs.lut)) {
      try {
        mainSource = this.lutRenderer!.process(main, srcW, srcH);
      } catch { /* renderer hiccup — draw the raw frame */ }
    }

    // Portrait mode crop-fills camera sources (a landscape webcam letterboxed
    // in a 9:16 frame is mostly bars); screens/media keep contain.
    const isCameraMain = main === this.cameraVideo || main === this.camera2Video;
    const coverFill = fillMode === 'cover' || (this.orientation === 'portrait' && isCameraMain);
    const staged = this.stageFilter(mainSource, srcW, srcH, filterCss);
    ctx.filter = staged.filter;
    let rect: { x: number; y: number; w: number; h: number };
    if (coverFill) {
      this.drawCoverSource(staged.source, srcW, srcH, x, y, w, h);
      rect = { x, y, w, h };
    } else {
      rect = this.drawContain(staged.source, x, y, w, h, srcW, srcH);
    }
    ctx.filter = 'none';
    this.applyGradeBlends(rect.x, rect.y, rect.w, rect.h);

    // Host camera PiP-in-scene (e.g. camera over a screen share) only when the
    // scene is full-frame. In a split-grid tile the host is already one source,
    // so an inner PiP would clutter the small tile. Suppressed entirely when the
    // user wants a clean excerpt (media source with no camera overlay).
    const cleanMedia = mediaReady && inputs.mediaHideCamera;
    if (fillMode === 'contain' && !cleanMedia) {
      let pipSlot = 0;
      if (cameraReady && main !== this.cameraVideo) {
        this.drawPip(this.cameraVideo, filterCss, x, y, w, h, pipSlot++);
      }
      if (camera2Ready && main !== this.camera2Video) {
        this.drawPip(this.camera2Video, filterCss, x, y, w, h, pipSlot++);
      }
    }
  }

  /** Color multiply / color add blends over an already-drawn video rect. */
  private applyGradeBlends(x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    const grade = this.inputs.grade;
    if (grade.multiplyEnabled) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = grade.multiplyColor;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
    if (grade.addEnabled) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = grade.addColor;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
  }

  /** PiP layout inserts: the host scene first, then any extra guests, anchored
   * to the BOTTOM-RIGHT corner (matching the guest studio's PiP inset) and
   * stacked upward. Fixed position — independent of the draggable host-camera
   * PiP used over screen shares. */
  private drawPipInserts(extraGuests: CompositorGuest[]) {
    const pw = Math.round(this.dw * PIP_WIDTH_FRAC);
    const ph = Math.round(pw * 9 / 16);
    const margin = Math.round(this.dw * 0.019);
    const gap = Math.round(margin * 0.75);
    const place = (slot: number, draw: (x: number, y: number, w: number, h: number) => void) => {
      const px = this.dw - pw - margin;
      const py = this.dh - ph - margin - slot * (ph + gap);
      draw(px, Math.max(margin, py), pw, ph);
    };
    // Slot 0: the host scene as a rounded PiP (unlabeled, matching the host's
    // no-name-chip convention in the split grid).
    place(0, (x, y, w, h) => {
      const { ctx } = this;
      ctx.save();
      roundRectPath(ctx, x, y, w, h, 10);
      ctx.clip();
      this.drawHostScene(x, y, w, h, 'cover');
      ctx.restore();
    });
    extraGuests.forEach((guest, i) => place(i + 1, (x, y, w, h) => this.drawGuestTile(guest, x, y, w, h)));
  }

  private drawGuestTile(guest: CompositorGuest, x: number, y: number, w: number, h: number, radius = 10) {
    const { ctx } = this;
    const entry = this.guestVideos.get(guest.sessionId);
    const video = entry?.video;

    ctx.save();
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.clip();

    if (video && hasLiveVideo(video)) {
      this.drawCover(video, x, y, w, h);
    } else {
      // Camera-off guest: initial avatar
      ctx.fillStyle = 'rgba(22, 25, 38, 1)';
      ctx.fillRect(x, y, w, h);
      const r = Math.min(w, h) * 0.16;
      ctx.fillStyle = COLORS.primary;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.onPrimary;
      ctx.font = `700 ${Math.round(r)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((guest.userName[0] || 'G').toUpperCase(), x + w / 2, y + h / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    // Name label chip
    ctx.font = `500 15px ${FONT}`;
    const name = truncate(ctx, guest.userName, w - 60);
    const labelW = ctx.measureText(name).width + 20;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    roundRectPath(ctx, x + 10, y + h - 36, labelW, 26, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, x + 20, y + h - 18);

    ctx.restore();
  }

  /** Lazily create the WebGL LUT renderer and keep its 3D texture current. */
  private ensureLut(lut: ParsedLut): boolean {
    if (this.lutRendererFailed) return false;
    try {
      if (!this.lutRenderer) this.lutRenderer = new LutRenderer();
      if (this.appliedLut !== lut) {
        this.lutRenderer.setLut(lut);
        if (!this.lutRenderer.selfTest()) throw new Error('LUT self-test rendered black');
        this.appliedLut = lut;
      }
      return true;
    } catch (err) {
      console.error('Broadcast LUT disabled — sending ungraded frames:', err);
      this.lutRendererFailed = true; // e.g. WebGL2 unavailable — don't retry per frame
      return false;
    }
  }

  /** Canvas 2D silently paints NOTHING when ctx.filter mixes CSS functions
   * with an SVG url() reference (the gamma filter). Split into two passes:
   * bake the function part into a staging canvas, and return the url() part,
   * which is safe to set alone. Single-kind filters pass through untouched. */
  private stageFilter(
    source: HTMLVideoElement | HTMLCanvasElement,
    srcW: number,
    srcH: number,
    filterCss: string,
  ): { source: HTMLVideoElement | HTMLCanvasElement; filter: string } {
    const urlAt = filterCss.indexOf('url(');
    if (urlAt <= 0 || !srcW || !srcH) {
      return { source, filter: filterCss || 'none' };
    }
    const fns = filterCss.slice(0, urlAt).trim();
    const ref = filterCss.slice(urlAt).trim();
    if (!this.filterStage) this.filterStage = document.createElement('canvas');
    const stage = this.filterStage;
    if (stage.width !== srcW || stage.height !== srcH) {
      stage.width = srcW;
      stage.height = srcH;
    }
    const sctx = stage.getContext('2d');
    if (!sctx) return { source, filter: fns }; // degrade: drop gamma, keep picture
    sctx.filter = fns;
    sctx.clearRect(0, 0, srcW, srcH);
    sctx.drawImage(source, 0, 0, srcW, srcH);
    sctx.filter = 'none';
    return { source: stage, filter: ref };
  }

  private drawContain(
    source: HTMLVideoElement | HTMLCanvasElement,
    x: number, y: number, w: number, h: number,
    srcW?: number, srcH?: number,
  ) {
    const sw = srcW ?? (source instanceof HTMLVideoElement ? source.videoWidth : source.width);
    const sh = srcH ?? (source instanceof HTMLVideoElement ? source.videoHeight : source.height);
    const scale = Math.min(w / sw, h / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    this.ctx.drawImage(source, dx, dy, dw, dh);
    return { x: dx, y: dy, w: dw, h: dh };
  }

  /** object-cover: crop source to fill the box */
  private drawCover(video: HTMLVideoElement, x: number, y: number, w: number, h: number) {
    this.drawCoverSource(video, video.videoWidth, video.videoHeight, x, y, w, h);
  }

  private drawCoverSource(
    source: HTMLVideoElement | HTMLCanvasElement,
    srcW: number, srcH: number,
    x: number, y: number, w: number, h: number,
  ) {
    const srcAspect = srcW / srcH;
    const boxAspect = w / h;
    let sx = 0, sy = 0, sw = srcW, sh = srcH;
    if (srcAspect > boxAspect) {
      sw = srcH * boxAspect;
      sx = (srcW - sw) / 2;
    } else {
      sh = srcW / boxAspect;
      sy = (srcH - sh) / 2;
    }
    this.ctx.drawImage(source, sx, sy, sw, sh, x, y, w, h);
  }

  private drawPip(video: HTMLVideoElement, filterCss: string, sceneX: number, sceneY: number, sceneW: number, sceneH: number, slot = 0) {
    const { ctx } = this;
    const pos = this.inputs.pipPosition ?? PIP_DEFAULT_POSITION;
    const pw = Math.round(sceneW * PIP_WIDTH_FRAC);
    const ph = Math.round(pw * 9 / 16);
    const margin = Math.round(sceneW * 0.019);
    // Anchor at the dragged position; extra PiPs stack below it. Clamp to the
    // same flush bounds the preview uses so what you drag is what broadcasts.
    let px = sceneX + pos.x * sceneW;
    let py = sceneY + pos.y * sceneH + slot * (ph + Math.round(margin * 0.75));
    px = Math.max(sceneX, Math.min(px, sceneX + sceneW - pw));
    py = Math.max(sceneY, Math.min(py, sceneY + sceneH - ph));

    ctx.save();
    roundRectPath(ctx, px, py, pw, ph, 12);
    ctx.clip();
    const staged = this.stageFilter(video, video.videoWidth, video.videoHeight, filterCss);
    ctx.filter = staged.filter;
    this.drawCoverSource(staged.source, video.videoWidth, video.videoHeight, px, py, pw, ph);
    ctx.filter = 'none';
    this.applyGradeBlends(px, py, pw, ph);
    ctx.restore();

    ctx.strokeStyle = 'rgba(6, 180, 224, 0.4)';
    ctx.lineWidth = 2;
    roundRectPath(ctx, px, py, pw, ph, 12);
    ctx.stroke();
  }

  private drawPlaceholder(x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const s = Math.min(w, h) / 720; // scale relative to the design short side

    ctx.fillStyle = COLORS.primary;
    ctx.beginPath();
    ctx.arc(cx, cy - 40 * s, 34 * s, 0, Math.PI * 2);
    ctx.fill();
    // Simple broadcast glyph: dot + arcs
    ctx.fillStyle = COLORS.onPrimary;
    ctx.beginPath();
    ctx.arc(cx, cy - 40 * s, 6 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.onPrimary;
    ctx.lineWidth = Math.max(1.5, 3 * s);
    ctx.beginPath();
    ctx.arc(cx, cy - 40 * s, 16 * s, -Math.PI / 4, Math.PI / 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - 40 * s, 16 * s, Math.PI * 3 / 4, Math.PI * 5 / 4);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.foreground;
    ctx.font = `600 ${Math.round(30 * s)}px ${FONT}`;
    ctx.fillText('Stream starting soon', cx, cy + 40 * s);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `400 ${Math.round(18 * s)}px ${FONT}`;
    ctx.fillText('The broadcast will resume shortly', cx, cy + 74 * s);
    ctx.textAlign = 'left';
  }

  private drawLowerThird() {
    // Drawing lives in the shared lowerThird module (also used by the video
    // editor). style.x/y is the block center as canvas fractions; the helper
    // clamps the block fully in frame, scaling by dh/720 (identity at 720p).
    const { title, subtitle, style } = this.inputs.lowerThird;
    drawLowerThirdBlock(
      this.ctx, { title, subtitle, style },
      (style.x ?? 0.5) * this.dw, (style.y ?? 0.88) * this.dh,
      this.dw, this.dh,
    );
  }

  private drawPoll(poll: Poll) {
    const { ctx } = this;
    const cw = 320;
    const pad = 18;
    const cx = this.dw - cw - 24;
    const innerW = cw - pad * 2;

    ctx.font = `600 19px ${FONT}`;
    const questionLines = wrapText(ctx, poll.question, innerW, 2);
    const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
    const optionH = 44;
    const ch = pad + 22 + questionLines.length * 26 + 8 + poll.options.length * optionH + 26 + pad / 2;
    const cy = 24;

    ctx.fillStyle = COLORS.card;
    roundRectPath(ctx, cx, cy, cw, ch, 12);
    ctx.fill();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    let y = cy + pad + 6;
    ctx.fillStyle = COLORS.primary;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText('POLL', cx + pad, y);
    y += 26;

    ctx.fillStyle = COLORS.foreground;
    ctx.font = `600 19px ${FONT}`;
    for (const line of questionLines) {
      ctx.fillText(line, cx + pad, y);
      y += 26;
    }
    y += 8;

    for (const opt of poll.options) {
      const pct = totalVotes > 0 ? (opt.votes / totalVotes) * 100 : 0;
      ctx.fillStyle = COLORS.foreground;
      ctx.font = `400 15px ${FONT}`;
      ctx.fillText(truncate(ctx, opt.text, innerW - 56), cx + pad, y + 4);
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(pct)}%`, cx + cw - pad, y + 4);
      ctx.textAlign = 'left';

      const barY = y + 14;
      ctx.fillStyle = COLORS.track;
      roundRectPath(ctx, cx + pad, barY, innerW, 7, 4);
      ctx.fill();
      if (pct > 0) {
        ctx.fillStyle = COLORS.primary;
        roundRectPath(ctx, cx + pad, barY, Math.max(7, innerW * pct / 100), 7, 4);
        ctx.fill();
      }
      y += optionH;
    }

    ctx.fillStyle = COLORS.muted;
    ctx.font = `400 13px ${FONT}`;
    ctx.fillText(`${totalVotes} votes`, cx + pad, y + 2);
  }

  private drawQuestion(question: Question) {
    const { ctx } = this;
    const cw = 440;
    const pad = 18;
    const innerW = cw - pad * 2;

    ctx.font = `500 17px ${FONT}`;
    const lines = wrapText(ctx, question.text, innerW, 3);
    const ch = pad + 24 + lines.length * 24 + pad / 2;
    const cx = 24;
    const cy = this.dh - ch - 110;

    ctx.fillStyle = COLORS.card;
    roundRectPath(ctx, cx, cy, cw, ch, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(6, 180, 224, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    let y = cy + pad + 4;
    ctx.fillStyle = COLORS.primary;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText('Q&A', cx + pad, y);
    const qaWidth = ctx.measureText('Q&A').width;
    ctx.fillStyle = COLORS.muted;
    ctx.font = `400 13px ${FONT}`;
    ctx.fillText(
      truncate(ctx, `${question.author} · ${question.platform}`, innerW - qaWidth - 12),
      cx + pad + qaWidth + 12,
      y,
    );
    y += 26;

    ctx.fillStyle = COLORS.foreground;
    ctx.font = `500 17px ${FONT}`;
    for (const line of lines) {
      ctx.fillText(line, cx + pad, y);
      y += 24;
    }
  }
}
