// On-device speech-recognition engine for the teleprompter's voice-follow,
// used where the browser's Web Speech API doesn't work (Brave, Safari, Firefox).
// Captures the mic, slices it into short overlapping windows, skips silence
// (ASR models hallucinate on silence), resamples to 16 kHz, and hands each
// window to the ASR worker (Moonshine — see whisperConfig.ts for why).
// Recognized text is streamed back via `onText`.
//
// transformers.js is NOT imported here — only in asrWorker.ts — so it stays out
// of the main bundle and loads lazily when voice-follow actually starts.

import { ASR_MODEL, MODEL_PROBE_URL } from './whisperConfig';

const MODEL = ASR_MODEL;
const TARGET_RATE = 16000;
// Rolling-window recognition: latency is decoupled from accuracy.
//   CONTEXT_SEC — how much recent audio Whisper sees each pass (accuracy).
//   HOP_SEC     — how much NEW speech triggers the next pass (latency).
// We re-transcribe the last CONTEXT_SEC of audio every HOP_SEC, so a freshly
// spoken word reaches the model within ~HOP_SEC instead of waiting for a whole
// fresh window to fill. Because every pass covers the MOST RECENT audio (not a
// backlog), the follow can never fall behind into stale speech, and no words
// are skipped as long as inference is faster than CONTEXT_SEC (true for
// moonshine-base). Overlapping passes re-emit words, but the matcher never
// regresses the pointer, so duplicates are harmless.
const DEFAULT_CONTEXT_SEC = 1.4;   // audio context per transcription pass
const DEFAULT_HOP_SEC = 0.45;      // new speech between passes (≈ follow latency;
                                   // Moonshine's no-padding passes are cheap enough)
// Sane bounds for the live-tunable dials (AV / teleprompter settings). Hop is
// capped below context so every pass always overlaps the previous one — that
// overlap is what guarantees no spoken word falls between passes.
const MIN_CONTEXT_SEC = 0.8, MAX_CONTEXT_SEC = 2.5;
const MIN_HOP_SEC = 0.3;
const SILENCE_RMS = 0.006; // below this, treat the context as silence and skip

// Adaptive stabilization: keep each inference pass under this wall-clock budget.
// When passes run slower (the "lag from time to time"), the engine shrinks the
// effective context toward ADAPT_MIN_CONTEXT_SEC so passes get cheaper and the
// follow stays responsive; when there's headroom it grows context back toward
// the user's target for accuracy. Purely a runtime behavior — the user's slider
// values are the ceiling, never overwritten.
const ADAPT_LATENCY_BUDGET_MS = 350;
const ADAPT_MIN_CONTEXT_SEC = 0.9;
const ADAPT_STEP_SEC = 0.05;
// Auto-latency headroom: when adaptive, the effective hop tracks a little above
// measured inference so passes never pile up but the follow stays as snappy as
// the hardware allows. A per-pass time above this reads as user-visible lag.
const AUTO_HOP_FACTOR = 1.2;
const BEHIND_MS = 450;

export type WhisperStatus = 'loading' | 'ready' | 'error';
export type AsrDevice = 'webgpu' | 'wasm';

/** Live inference telemetry for the diagnostics UI, emitted after each pass. */
export interface WhisperStats {
  /** Execution provider actually running (may differ from requested if GPU init fell back). */
  device: AsrDevice;
  /** Wall-clock time of the most recent transcription pass, ms. */
  lastMs: number;
  /** Smoothed (EMA) pass time, ms — the headline "how fast is it" number. */
  avgMs: number;
  /** Recent peak pass time (slow-decaying), ms — surfaces the spikes. */
  maxMs: number;
  /** True when inference can't keep up with the desired cadence (avg > effective hop). */
  behind: boolean;
  /** Effective context/hop currently in use (differ from targets when adapting), ms. */
  effContextMs: number;
  effHopMs: number;
}

export interface WhisperHandlers {
  onText: (text: string) => void;
  onStatus: (status: WhisperStatus, detail?: { progress?: number; error?: string }) => void;
  /** Live mic input level 0–100, for the "it's hearing you" meter. */
  onLevel?: (level: number) => void;
  /** The label of the microphone actually being captured. */
  onMic?: (label: string) => void;
  /** Per-pass inference telemetry, for the latency/health readout. */
  onStats?: (stats: WhisperStats) => void;
}

function downsample(input: Float32Array, srcRate: number): Float32Array {
  if (srcRate === TARGET_RATE) return input;
  const ratio = srcRate / TARGET_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    out[i] = (input[i0] ?? 0) * (1 - frac) + (input[i0 + 1] ?? 0) * frac;
  }
  return out;
}

function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, buf.length));
}

// Open the microphone chosen in AV Settings (`deviceId`), pinning it with
// `exact` so the browser actually switches to it. A `deviceId: { ideal }` hint
// is only advisory — Chrome routinely ignores it and returns the *default*
// device — so `ideal` would silently keep capturing the built-in mic. If the
// exact device can't open (unplugged / in use), fall back to the system default
// rather than throwing; permission and other errors propagate so the failure
// stays diagnosable.
async function openMic(deviceId?: string | null): Promise<MediaStream> {
  const audio: MediaTrackConstraints = {
    echoCancellation: true, noiseSuppression: true, autoGainControl: true,
  };
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: deviceId } } });
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw err;
      // else: device gone — fall through to the default mic
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio });
}

export class WhisperEngine {
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private handlers: WhisperHandlers | null = null;
  private buffer: Float32Array[] = [];      // rolling audio, trimmed to CONTEXT_SEC
  private bufferLen = 0;
  private newSamples = 0;                    // new audio accumulated since the last pass
  private contextSec = DEFAULT_CONTEXT_SEC;  // target (live-tunable, see setTuning)
  private hopSec = DEFAULT_HOP_SEC;
  private effContextSec = DEFAULT_CONTEXT_SEC; // adaptive working value ≤ contextSec
  private adaptive = true;                    // auto-stabilize under latency pressure
  private preferWebGPU = false;               // try GPU before WASM at (re)start
  private device: AsrDevice = 'wasm';         // provider actually loaded
  private ready = false;
  private msgId = 0;
  private inFlight = false;
  private inflightSince = 0;                  // performance.now() when the pass was posted
  private avgMs = 0;                          // EMA of pass wall-time
  private maxMs = 0;                          // slow-decaying peak
  private errorStreak = 0;   // consecutive post-ready transcribe failures
  private triedWasm = false;
  private stopped = false;

  async start(handlers: WhisperHandlers, deviceId?: string | null): Promise<void> {
    this.handlers = handlers;
    this.stopped = false;
    // Fresh session: reset adaptive/telemetry state.
    this.effContextSec = this.contextSec;
    this.avgMs = 0; this.maxMs = 0; this.triedWasm = false;
    handlers.onStatus('loading', { progress: 0 });

    // Capture the SAME microphone chosen in AV Settings (`deviceId`).
    try {
      this.stream = await openMic(deviceId);
    } catch (err) {
      handlers.onStatus('error', { error: 'mic: ' + String(err) });
      return;
    }
    if (this.stopped) { this.teardownAudio(); return; }
    handlers.onMic?.(this.stream.getAudioTracks()[0]?.label || 'Microphone');

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioCtx();
    // Created after an await, so it may be suspended — resume (we're still in
    // the Start-click gesture chain).
    void this.ctx.resume();
    const srcRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);

    let lastLevelAt = 0;
    this.node.onaudioprocess = (ev) => {
      if (this.stopped) return;
      const block = ev.inputBuffer.getChannelData(0);

      // Live input meter (throttled ~10/s) so the host can see it's hearing
      // them. Runs even before the model is ready, so the meter is live while
      // the model loads.
      const now = performance.now();
      if (this.handlers?.onLevel && now - lastLevelAt > 90) {
        lastLevelAt = now;
        const level = Math.min(100, Math.round(Math.sqrt(rms(block)) * 130));
        this.handlers.onLevel(level);
      }

      if (!this.ready) return;

      // Read the effective dials each pass so live slider changes, adaptive
      // context-trim, AND auto-latency all apply without restarting the engine.
      const effContextSec = this.currentContextSec();
      const effHopSec = this.currentHopSec(effContextSec);
      const contextSamples = Math.floor(effContextSec * srcRate);
      const hopSamples = Math.floor(effHopSec * srcRate);

      // Append to the rolling buffer and trim the front so we retain only the
      // last contextSec of audio — the buffer never grows into a backlog.
      this.buffer.push(new Float32Array(block));
      this.bufferLen += ev.inputBuffer.length;
      this.newSamples += ev.inputBuffer.length;
      while (this.bufferLen - this.buffer[0].length >= contextSamples && this.buffer.length > 1) {
        this.bufferLen -= this.buffer[0].length;
        this.buffer.shift();
      }

      // Transcribe once hopSec of fresh speech has arrived (and the previous
      // pass has finished). While inference runs we keep rolling the buffer, so
      // the next pass still sees the newest contextSec — never stale audio.
      if (this.inFlight || this.newSamples < hopSamples) return;
      this.newSamples = 0;

      // Flatten the current rolling context window.
      const window = new Float32Array(this.bufferLen);
      let off = 0;
      for (const b of this.buffer) { window.set(b, off); off += b.length; }

      if (rms(window) < SILENCE_RMS) return; // skip silence
      const audio = downsample(window, srcRate);
      this.inFlight = true;
      this.inflightSince = performance.now();
      this.worker?.postMessage({ type: 'transcribe', id: ++this.msgId, audio }, [audio.buffer]);
    };

    this.source.connect(this.node);
    // ScriptProcessor only fires onaudioprocess when connected to a destination.
    // We never write to its output buffer, so it emits silence — no echo of the
    // mic to the speakers.
    this.node.connect(this.ctx.destination);

    // Preflight: confirm the model is actually reachable and report the EXACT
    // URL if not, so a failure is diagnosable (e.g. "not uploaded yet" → run
    // `npm run upload:model`) instead of a bare "Failed to fetch".
    try {
      const res = await fetch(MODEL_PROBE_URL, { method: 'GET', cache: 'no-store' });
      if (this.stopped) { this.teardownAudio(); return; }
      if (!res.ok) {
        handlers.onStatus('error', {
          error: `model not found (HTTP ${res.status}) at ${MODEL_PROBE_URL} — has it been uploaded? run: npm run upload:model`,
        });
        this.teardownAudio();
        return;
      }
    } catch (err) {
      handlers.onStatus('error', { error: `cannot reach model at ${MODEL_PROBE_URL} — ${String(err)}` });
      this.teardownAudio();
      return;
    }

    // Start on WASM (single-thread, q8 weights — the reliable path needing no
    // COOP/COEP headers) unless the user opted into WebGPU. WebGPU uses the same
    // uploaded q8 files; if the GPU provider can't run them it errors and the
    // handler below falls back to WASM, so the opt-in is always safe.
    this.spawnWorker(this.preferWebGPU ? 'webgpu' : 'wasm');
  }

  /**
   * Swap the captured microphone live — used when AV Settings changes the mic
   * mid-session. Keeps the loaded model, worker, and audio node; only the input
   * stream and its source node are replaced, so the follow never pauses and the
   * model isn't reloaded. No-op if the engine isn't running.
   */
  async switchMic(deviceId?: string | null): Promise<void> {
    if (this.stopped || !this.ctx || !this.node) return;
    let next: MediaStream;
    try {
      next = await openMic(deviceId);
    } catch {
      return; // keep the current mic if the requested one can't open
    }
    // Stopped, or a newer switch already landed, while we were awaiting.
    if (this.stopped || !this.ctx || !this.node) { next.getTracks().forEach(t => t.stop()); return; }

    try { this.source?.disconnect(); } catch { /* noop */ }
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = next;
    this.source = this.ctx.createMediaStreamSource(next);
    this.source.connect(this.node);
    // Drop the audio captured from the previous mic.
    this.buffer = []; this.bufferLen = 0; this.newSamples = 0;
    this.handlers?.onMic?.(next.getAudioTracks()[0]?.label || 'Microphone');
  }

  /**
   * Live-adjust the follow's latency/accuracy trade-off without restarting the
   * engine (the audio loop reads these each pass). `hopSec` is how much fresh
   * speech triggers the next transcription (lower = snappier follow); `contextSec`
   * is how much recent audio each pass hands to Whisper (higher = more accurate,
   * heavier). Values are clamped, and hop is kept strictly below context so
   * consecutive passes always overlap and never skip a spoken word.
   */
  setTuning(contextSec: number, hopSec: number): void {
    const ctx = Math.max(MIN_CONTEXT_SEC, Math.min(MAX_CONTEXT_SEC, contextSec));
    // Cap hop a little under context so there's always overlap between passes.
    const hop = Math.max(MIN_HOP_SEC, Math.min(ctx - 0.2, hopSec));
    this.contextSec = ctx;
    this.hopSec = hop;
    // Effective context can't exceed the new target; adaptation grows it back up.
    this.effContextSec = Math.min(this.effContextSec, ctx);
  }

  /** Context actually in use this instant (adaptation shrinks it under load). */
  private currentContextSec(): number {
    return this.adaptive ? this.effContextSec : this.contextSec;
  }

  /**
   * Hop actually in use this instant. When adaptive, this AUTO-derives the
   * snappiest hop that still keeps pace with measured inference (a little above
   * the average pass time), capped by the user's latency slider — so the follow
   * stays responsive even if that slider is left high. When not adaptive, the
   * slider value is used directly. Always kept under context so passes overlap.
   */
  private currentHopSec(contextSec: number): number {
    const ceiling = Math.max(MIN_HOP_SEC, Math.min(this.hopSec, contextSec - 0.2));
    if (!this.adaptive) return ceiling;
    const fromLatency = this.avgMs > 0 ? (this.avgMs * AUTO_HOP_FACTOR) / 1000 : ceiling;
    return Math.max(MIN_HOP_SEC, Math.min(ceiling, fromLatency));
  }

  /** Toggle adaptive stabilization. Off pins the effective context to the target. */
  setAdaptive(on: boolean): void {
    this.adaptive = on;
    if (!on) this.effContextSec = this.contextSec;
  }

  /**
   * Prefer the WebGPU execution provider (falls back to WASM if it can't init).
   * If the engine is already running, hot-swap the worker so the change applies
   * without a full Stop/Start — the follow pauses only for the model reload.
   */
  setPreferWebGPU(on: boolean): void {
    if (this.preferWebGPU === on) return;
    this.preferWebGPU = on;
    if (this.stopped || !this.ctx) return; // not running — applies at next start()
    this.triedWasm = false;                // allow the webgpu→wasm fallback to fire again
    this.spawnWorker(on ? 'webgpu' : 'wasm');
  }

  /** Record a completed pass: update latency stats, adapt context, emit telemetry. */
  private recordPass(): void {
    if (this.inflightSince <= 0) return;
    const ms = performance.now() - this.inflightSince;
    this.inflightSince = 0;
    this.avgMs = this.avgMs === 0 ? ms : this.avgMs * 0.7 + ms * 0.3;
    this.maxMs = Math.max(ms, this.maxMs * 0.9);

    if (this.adaptive) {
      if (this.avgMs > ADAPT_LATENCY_BUDGET_MS) {
        this.effContextSec = Math.max(ADAPT_MIN_CONTEXT_SEC, this.effContextSec - ADAPT_STEP_SEC);
      } else if (this.avgMs < ADAPT_LATENCY_BUDGET_MS * 0.6) {
        this.effContextSec = Math.min(this.contextSec, this.effContextSec + ADAPT_STEP_SEC);
      }
    }

    const effContextSec = this.currentContextSec();
    const effHopSec = this.currentHopSec(effContextSec);
    this.handlers?.onStats?.({
      device: this.device,
      lastMs: Math.round(ms),
      avgMs: Math.round(this.avgMs),
      // Peak floors at the average: the slow-decaying max can dip just under a
      // rising EMA during steady runs, which would nonsensically read peak < avg.
      maxMs: Math.round(Math.max(this.maxMs, this.avgMs)),
      // "Behind" is absolute now (auto-hop tracks avg, so avg>hop never fires):
      // a pass slower than BEHIND_MS is what actually reads as lag to the host.
      behind: this.avgMs > BEHIND_MS,
      effContextMs: Math.round(effContextSec * 1000),
      effHopMs: Math.round(effHopSec * 1000),
    });
  }

  private spawnWorker(device: AsrDevice) {
    this.worker?.terminate();
    this.ready = false;
    this.device = device;      // provisional; confirmed on 'ready', downgraded on fallback
    this.inFlight = false;
    this.inflightSince = 0;
    this.worker = new Worker(new URL('./asrWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'progress') {
        this.handlers?.onStatus('loading', { progress: Math.round((m.progress ?? 0)) });
      } else if (m.type === 'ready') {
        this.ready = true;
        this.handlers?.onStatus('ready');
      } else if (m.type === 'text') {
        this.inFlight = false;
        this.recordPass();
        this.errorStreak = 0;
        // Debug trace of what the engine actually heard — first thing to check
        // when voice-follow isn't advancing (devtools console, Verbose level).
        console.debug('[teleprompter] whisper heard:', m.text);
        if (!this.stopped && typeof m.text === 'string' && m.text.trim()) {
          this.handlers?.onText(m.text);
        }
      } else if (m.type === 'error') {
        this.inFlight = false;
        this.inflightSince = 0; // failed pass — don't fold its time into latency stats
        // WebGPU can fail to init on some GPUs/drivers — fall back to WASM once.
        if (device === 'webgpu' && !this.triedWasm) {
          this.triedWasm = true;
          this.spawnWorker('wasm');
        } else if (!this.ready) {
          this.handlers?.onStatus('error', { error: String(m.error) });
        } else {
          // Post-ready transcription failure. One-off errors can be transient,
          // but a streak means every window is failing — surface it instead of
          // silently stalling the follow (the old behavior swallowed these).
          console.warn('[teleprompter] whisper transcribe error:', m.error);
          if (++this.errorStreak >= 3) {
            this.handlers?.onStatus('error', { error: 'transcription failing: ' + String(m.error) });
          }
        }
      }
    };
    this.worker.postMessage({ type: 'load', model: MODEL, device });
  }

  private teardownAudio() {
    try { this.node?.disconnect(); } catch { /* noop */ }
    try { this.source?.disconnect(); } catch { /* noop */ }
    try { void this.ctx?.close(); } catch { /* noop */ }
    this.stream?.getTracks().forEach(t => t.stop());
    this.node = null; this.source = null; this.ctx = null; this.stream = null;
    this.buffer = []; this.bufferLen = 0; this.newSamples = 0;
  }

  stop() {
    this.stopped = true;
    this.ready = false;
    this.inFlight = false;
    this.teardownAudio();
  }

  /** Fully release the worker (call when the teleprompter unmounts). */
  dispose() {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
  }
}
