/**
 * VST-style audio effects rack for the broadcast microphone.
 *
 * Real VST/VST3 plugins are native binaries and cannot run in a browser, so
 * this recreates the same channel-strip building blocks with the Web Audio API:
 * high/low-pass shaping, a compressor, waveshaper saturation ("drive"), a
 * convolution reverb, and a feedback delay — all serial into a parallel wet/dry
 * mix. It slots into the compositor's mic path right after the EQ, so effects
 * reach the outgoing mix AND recordings with no extra plumbing.
 *
 * Everything is expressed as 0–100 "amount" knobs (plus Hz/ms where natural) so
 * presets read like a plugin's factory bank rather than raw DSP coefficients.
 */

export interface AudioEffectsSettings {
  /** Master bypass — when false the rack is a clean pass-through. */
  enabled: boolean;
  /** Active preset id, or 'custom' once any knob is touched. */
  preset: string;
  /** High-pass cutoff in Hz (20 = effectively off). Removes rumble/plosives. */
  highpass: number;
  /** Low-pass cutoff in Hz (20000 = off). Darkens / lo-fi telephone tone. */
  lowpass: number;
  /** Compression amount 0–100 (maps to threshold + ratio + makeup). */
  compression: number;
  /** Saturation / harmonic drive 0–100 (waveshaper). */
  drive: number;
  /** Reverb wet mix 0–100. */
  reverb: number;
  /** Reverb tail length 0–100 (impulse response duration/decay). */
  reverbSize: number;
  /** Delay/echo wet mix 0–100. */
  delay: number;
  /** Delay time in ms. */
  delayTime: number;
  /** Delay feedback 0–100 (regeneration; capped below runaway). */
  delayFeedback: number;
}

export const AUDIO_EFFECTS_NEUTRAL: AudioEffectsSettings = {
  enabled: false,
  preset: 'none',
  highpass: 20,
  lowpass: 20000,
  compression: 0,
  drive: 0,
  reverb: 0,
  reverbSize: 50,
  delay: 0,
  delayTime: 180,
  delayFeedback: 20,
};

export interface AudioPreset {
  id: string;
  label: string;
  description: string;
  settings: Partial<AudioEffectsSettings>;
}

/** Factory bank. `none` is the bypass; the rest each lean on a different part
 * of the rack so the list doubles as a demo of what's available. */
export const AUDIO_PRESETS: AudioPreset[] = [
  { id: 'none', label: 'Off', description: 'No effects — clean signal.', settings: {} },
  {
    id: 'podcast', label: 'Podcast', description: 'Controlled, intimate voice with rumble filtered out.',
    settings: { highpass: 80, lowpass: 20000, compression: 45, drive: 10, reverb: 0, delay: 0 },
  },
  {
    id: 'broadcast', label: 'Broadcast', description: 'Punchy radio-announcer presence and loudness.',
    settings: { highpass: 90, lowpass: 20000, compression: 72, drive: 22, reverb: 0, delay: 0 },
  },
  {
    id: 'warm', label: 'Warm', description: 'Analog-style warmth and gentle glue.',
    settings: { highpass: 60, lowpass: 16000, compression: 32, drive: 38, reverb: 0, delay: 0 },
  },
  {
    id: 'telephone', label: 'Telephone', description: 'Narrow-band lo-fi phone / walkie tone.',
    settings: { highpass: 500, lowpass: 3000, compression: 60, drive: 25, reverb: 0, delay: 0 },
  },
  {
    id: 'megaphone', label: 'Megaphone', description: 'Distorted, midrange PA blast.',
    settings: { highpass: 700, lowpass: 4000, compression: 80, drive: 72, reverb: 8, reverbSize: 20, delay: 0 },
  },
  {
    id: 'hall', label: 'Concert Hall', description: 'Spacious room reverb around the voice.',
    settings: { highpass: 70, compression: 26, drive: 8, reverb: 45, reverbSize: 78, delay: 0 },
  },
  {
    id: 'slapback', label: 'Slapback', description: 'Short vintage rockabilly echo.',
    settings: { highpass: 70, compression: 30, drive: 15, reverb: 0, delay: 32, delayTime: 110, delayFeedback: 12 },
  },
  {
    id: 'space-echo', label: 'Space Echo', description: 'Dub-style repeats washed into reverb.',
    settings: { highpass: 80, compression: 24, drive: 18, reverb: 26, reverbSize: 62, delay: 46, delayTime: 320, delayFeedback: 48 },
  },
];

/** UI metadata for the adjustable knobs, grouped like a plugin's sections. */
export const AUDIO_FX_PARAMS: {
  key: keyof AudioEffectsSettings;
  label: string;
  group: 'Filters' | 'Dynamics' | 'Reverb' | 'Delay';
  min: number;
  max: number;
  step: number;
  unit: string;
  /** Value at/above/below which the control is effectively bypassed. */
  offAt?: number;
}[] = [
  { key: 'highpass', label: 'High-pass', group: 'Filters', min: 20, max: 1000, step: 10, unit: 'Hz', offAt: 20 },
  { key: 'lowpass', label: 'Low-pass', group: 'Filters', min: 1000, max: 20000, step: 100, unit: 'Hz', offAt: 20000 },
  { key: 'compression', label: 'Compression', group: 'Dynamics', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'drive', label: 'Drive', group: 'Dynamics', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'reverb', label: 'Reverb Mix', group: 'Reverb', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'reverbSize', label: 'Reverb Size', group: 'Reverb', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'delay', label: 'Delay Mix', group: 'Delay', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'delayTime', label: 'Delay Time', group: 'Delay', min: 0, max: 1000, step: 10, unit: 'ms' },
  { key: 'delayFeedback', label: 'Feedback', group: 'Delay', min: 0, max: 100, step: 1, unit: '%' },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Waveshaper transfer curve. `amount` 0 → linear (no distortion); higher →
 * progressively harder soft-clip for saturation/overdrive.
 *
 * Uses tanh(k·x)/k so the small-signal gain stays ≈1 at every drive setting:
 * quiet passages pass through cleanly and — critically — drive never
 * re-amplifies frequencies the filters just removed, while loud peaks fold
 * over into harmonics (natural saturation, slightly reduced peak level). */
function makeDriveCurve(amount: number): Float32Array {
  const n = 2048;
  const curve = new Float32Array(n);
  const a = clamp(amount, 0, 100) / 100;
  const k = a * 6; // shaping depth
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = a === 0 ? x : Math.tanh(k * x) / k;
  }
  return curve;
}

/** Synthesize an exponentially-decaying stereo noise impulse for the convolver.
 * `size` 0–100 scales both the tail length (~0.2–4s) and the decay steepness. */
function makeReverbImpulse(ctx: BaseAudioContext, size: number): AudioBuffer {
  const s = clamp(size, 0, 100) / 100;
  const rate = ctx.sampleRate;
  const seconds = 0.2 + s * 3.8;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = ctx.createBuffer(2, length, rate);
  const decay = 2 + s * 4;
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

/**
 * A self-contained effects subgraph. Connect a source into `input` and take the
 * result from `output`; call `apply()` whenever settings change. Regenerating
 * the drive curve and reverb impulse is guarded so `apply()` is cheap to call
 * on every update.
 *
 *   input → highpass → lowpass → compressor → drive → makeup ─┬─ dry ───────────→ output
 *                                                             ├─ convolver → wet →┤
 *                                                             └─ delay(+fb) → wet →┘
 */
export class AudioEffectsRack {
  readonly input: GainNode;
  readonly output: GainNode;
  private ctx: BaseAudioContext;
  private hpf: BiquadFilterNode;
  private lpf: BiquadFilterNode;
  private comp: DynamicsCompressorNode;
  private shaper: WaveShaperNode;
  private makeup: GainNode;
  private dry: GainNode;
  private convolver: ConvolverNode;
  private reverbWet: GainNode;
  private delayNode: DelayNode;
  private feedback: GainNode;
  private delayWet: GainNode;
  private curDrive = -1;
  private curReverbSize = -1;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.hpf = ctx.createBiquadFilter();
    this.hpf.type = 'highpass';
    this.hpf.frequency.value = 20;
    this.lpf = ctx.createBiquadFilter();
    this.lpf.type = 'lowpass';
    this.lpf.frequency.value = 20000;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.knee.value = 24;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.25;

    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.shaper.curve = makeDriveCurve(0);
    this.curDrive = 0;

    this.makeup = ctx.createGain();
    this.dry = ctx.createGain();

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeReverbImpulse(ctx, AUDIO_EFFECTS_NEUTRAL.reverbSize);
    this.curReverbSize = AUDIO_EFFECTS_NEUTRAL.reverbSize;
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 0;

    this.delayNode = ctx.createDelay(1.0);
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0;
    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = 0;

    // Serial channel strip
    this.input.connect(this.hpf);
    this.hpf.connect(this.lpf);
    this.lpf.connect(this.comp);
    this.comp.connect(this.shaper);
    this.shaper.connect(this.makeup);

    // Parallel wet/dry sends off the makeup node
    this.makeup.connect(this.dry);
    this.dry.connect(this.output);

    this.makeup.connect(this.convolver);
    this.convolver.connect(this.reverbWet);
    this.reverbWet.connect(this.output);

    this.makeup.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);
    this.delayWet.connect(this.output);
    this.delayNode.connect(this.feedback);
    this.feedback.connect(this.delayNode);
  }

  apply(s: AudioEffectsSettings) {
    const t = this.ctx.currentTime;
    const on = s.enabled;
    const ramp = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.05);

    // Filters (bypassed = extremes that pass the full band)
    ramp(this.hpf.frequency, on ? clamp(s.highpass, 20, 20000) : 20);
    ramp(this.lpf.frequency, on ? clamp(s.lowpass, 20, 20000) : 20000);

    // Compression: amount → deeper threshold, higher ratio, more makeup
    const c = on ? clamp(s.compression, 0, 100) / 100 : 0;
    ramp(this.comp.threshold, -6 - c * 30); // 0 → -6 dB, 100 → -36 dB
    ramp(this.comp.ratio, 1 + c * 11); // 1:1 → 12:1
    ramp(this.makeup.gain, 1 + c * 0.6);

    // Drive (rebuild curve only when the amount changes)
    const drive = on ? clamp(s.drive, 0, 100) : 0;
    if (drive !== this.curDrive) {
      this.shaper.curve = makeDriveCurve(drive);
      this.curDrive = drive;
    }

    // Reverb (rebuild impulse only when size changes)
    const size = on ? clamp(s.reverbSize, 0, 100) : this.curReverbSize;
    if (size !== this.curReverbSize) {
      this.convolver.buffer = makeReverbImpulse(this.ctx, size);
      this.curReverbSize = size;
    }
    ramp(this.reverbWet.gain, on ? clamp(s.reverb, 0, 100) / 100 : 0);

    // Delay (feedback capped at 0.9 to avoid runaway self-oscillation)
    ramp(this.delayNode.delayTime, on ? clamp(s.delayTime, 0, 1000) / 1000 : 0);
    ramp(this.feedback.gain, on ? (clamp(s.delayFeedback, 0, 100) / 100) * 0.9 : 0);
    ramp(this.delayWet.gain, on ? clamp(s.delay, 0, 100) / 100 : 0);

    this.dry.gain.setTargetAtTime(1, t, 0.05);
  }

  disconnect() {
    for (const n of [
      this.input, this.hpf, this.lpf, this.comp, this.shaper, this.makeup,
      this.dry, this.convolver, this.reverbWet, this.delayNode, this.feedback,
      this.delayWet, this.output,
    ]) {
      try { n.disconnect(); } catch { /* already torn down */ }
    }
  }
}
