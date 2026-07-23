import { useStudio, MAX_EXTRA_MICS, type ExtraMic } from '@/contexts/StudioContext';
import { useAudioLevel } from '@/hooks/useAudioLevel';
import { EQ_BANDS, createEqChain, applyEqGains, type EqGains } from '@/lib/streamCompositor';
import { AudioEffectsRack, type AudioEffectsSettings } from '@/lib/audioEffects';
import { Volume2, VolumeX, MicOff, Mic, Plus, X, Radio, Minus, RotateCcw } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useEffect, useRef, useState } from 'react';

/** Live frequency spectrum of the mic AFTER the EQ chain: the same biquad
 * bands the broadcast uses run locally into an analyser (never to speakers,
 * so no monitoring echo), and the bars react as the gains move. */
function EqSpectrum({ stream, eq, fx }: { stream: MediaStream | null; eq: EqGains; fx: AudioEffectsSettings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const filtersRef = useRef<BiquadFilterNode[] | null>(null);
  const fxRackRef = useRef<AudioEffectsRack | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stream || stream.getAudioTracks().length === 0) return;

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const filters = createEqChain(audioCtx);
    filtersRef.current = filters;
    // Same EQ → FX chain the broadcast uses, so the bars reflect the full
    // processing (filters/compression/drive) as you tune it. Never routed to
    // speakers, so there's no monitoring echo.
    const fxRack = new AudioEffectsRack(audioCtx);
    fxRackRef.current = fxRack;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(filters[0]);
    filters[filters.length - 1].connect(fxRack.input);
    fxRack.output.connect(analyser);

    // Theme colors for the bars (CSS vars hold HSL triples)
    const css = getComputedStyle(document.documentElement);
    const hsl = (name: string, fallback: string) =>
      `hsl(${css.getPropertyValue(name).trim() || fallback})`;
    const colFrom = hsl('--success', '152 66% 45%');
    const colMid = hsl('--primary', '194 95% 45%');
    const colTo = hsl('--accent', '32 94% 55%');

    const bins = new Uint8Array(analyser.frequencyBinCount);
    const ctx2d = canvas.getContext('2d');
    let raf = 0;
    const BAR_COUNT = 48;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!ctx2d) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, w, h);

      analyser.getByteFrequencyData(bins);
      const grad = ctx2d.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, colFrom);
      grad.addColorStop(0.55, colMid);
      grad.addColorStop(1, colTo);
      ctx2d.fillStyle = grad;

      const barW = w / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i++) {
        // Log frequency mapping so lows aren't squeezed into two bars
        const t0 = Math.pow(bins.length, i / BAR_COUNT) - 1;
        const t1 = Math.pow(bins.length, (i + 1) / BAR_COUNT) - 1;
        let peak = 0;
        for (let b = Math.floor(t0); b <= Math.min(bins.length - 1, Math.floor(t1)); b++) {
          peak = Math.max(peak, bins[b]);
        }
        const barH = Math.max(1.5, (peak / 255) * h);
        ctx2d.globalAlpha = 0.35 + 0.65 * (peak / 255);
        ctx2d.fillRect(i * barW + 1, h - barH, barW - 2, barH);
      }
      ctx2d.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      fxRack.disconnect();
      filtersRef.current = null;
      fxRackRef.current = null;
      audioCtxRef.current = null;
      audioCtx.close().catch(() => { /* already closed */ });
    };
  }, [stream]);

  // Follow the band gains live so the animation shows the EQ's effect
  useEffect(() => {
    if (filtersRef.current && audioCtxRef.current) {
      applyEqGains(filtersRef.current, eq, audioCtxRef.current);
    }
  }, [eq]);

  // Follow the effects rack live so the bars react to filters/drive/compression
  useEffect(() => {
    fxRackRef.current?.apply(fx);
  }, [fx]);

  if (!stream || stream.getAudioTracks().length === 0) {
    return (
      <div className="h-16 rounded-md border border-border bg-secondary/30 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <MicOff className="h-3.5 w-3.5" />
        Enable the camera to see the mic spectrum
      </div>
    );
  }
  return <canvas ref={canvasRef} className="w-full h-16 rounded-md border border-border bg-secondary/30" />;
}

/** One EQ band: vertical slider (draggable point) + −/+ nudge buttons. */
function EqBandControl({ label, range, value, onChange }: {
  label: string;
  range: string;
  value: number;
  onChange: (db: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`text-[11px] font-mono tabular-nums ${value !== 0 ? 'text-primary' : 'text-muted-foreground'}`}>
        {value > 0 ? `+${value}` : value} dB
      </span>
      <SliderPrimitive.Root
        orientation="vertical"
        min={-12}
        max={12}
        step={1}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="relative flex h-24 w-5 touch-none select-none flex-col items-center justify-center"
      >
        <SliderPrimitive.Track className="relative h-full w-1.5 grow overflow-hidden rounded-full bg-secondary">
          <SliderPrimitive.Range className="absolute w-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-3.5 w-3.5 rounded-full border-2 border-primary bg-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </SliderPrimitive.Root>
      <div className="flex gap-1">
        <button
          onClick={() => onChange(Math.max(-12, value - 1))}
          className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title={`${label} −1 dB`}
        >
          <Minus className="h-3 w-3" />
        </button>
        <button
          onClick={() => onChange(Math.min(12, value + 1))}
          className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title={`${label} +1 dB`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      <span className="text-[11px] text-foreground font-medium leading-none mt-0.5">{label}</span>
      <span className="text-[9px] text-muted-foreground leading-none">{range}</span>
    </div>
  );
}

function ExtraMicRow({
  mic, index, audioDevices, onDevice, onVolume, onToggle, onRemove,
}: {
  mic: ExtraMic;
  index: number;
  audioDevices: MediaDeviceInfo[];
  onDevice: (deviceId: string) => void;
  onVolume: (v: number) => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const level = useAudioLevel(mic.stream);
  const active = !!mic.stream;

  return (
    <div className={`rounded-lg p-2.5 space-y-2 border transition-colors ${
      active ? 'border-success/40 bg-success/5' : 'border-border bg-secondary/30'
    }`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          Mic {index + 2}
          {active && <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-live" />}
        </span>
        <button
          onClick={onRemove}
          className="p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors"
          title="Remove mic"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <Select value={mic.deviceId ?? undefined} onValueChange={onDevice}>
        <SelectTrigger className="w-full text-xs h-8">
          <SelectValue placeholder="Choose microphone" />
        </SelectTrigger>
        <SelectContent>
          {audioDevices.map((d, di) => (
            <SelectItem key={d.deviceId || di} value={d.deviceId} className="text-xs">
              {d.label || `Microphone ${di + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        size="sm"
        variant={active ? 'destructive' : 'default'}
        onClick={onToggle}
        disabled={!mic.deviceId}
        className="w-full h-7 gap-1.5 text-[11px]"
      >
        {active ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
        {active ? 'Stop' : 'Activate'}
      </Button>

      {active && (
        <>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-100"
              style={{
                width: `${level}%`,
                background: 'linear-gradient(90deg, hsl(var(--success)), hsl(var(--accent)), hsl(var(--destructive)))',
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Slider
              value={[mic.volume]}
              onValueChange={([v]) => onVolume(v)}
              max={100}
              step={1}
              className="flex-1"
            />
            <span className="text-[11px] font-mono text-muted-foreground w-9 text-right tabular-nums">
              {mic.volume}%
            </span>
          </div>
        </>
      )}
    </div>
  );
}

type ProcessingKey = 'noiseSuppression' | 'echoCancellation' | 'autoGainControl';

const PROCESSING_LABELS: Record<ProcessingKey, string> = {
  noiseSuppression: 'Noise Suppression',
  echoCancellation: 'Echo Cancellation',
  autoGainControl: 'Auto Gain',
};

export function AudioMixer() {
  const {
    volume, setVolume, isMicOn, toggleMic, cameraStream,
    selectedMicId, selectMic,
    audioDevices, extraMics, addExtraMic, removeExtraMic,
    setExtraMicDevice, setExtraMicVolume, toggleExtraMic,
    eqGains, setEqBand, resetEq, audioEffects,
  } = useStudio();
  const inputLevel = useAudioLevel(cameraStream);
  const audioTrack = cameraStream?.getAudioTracks()[0] ?? null;

  const [processing, setProcessing] = useState<Record<ProcessingKey, boolean>>({
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
  });

  // Read the browser's actual applied settings whenever the mic track changes
  useEffect(() => {
    if (!audioTrack) return;
    const settings = audioTrack.getSettings();
    setProcessing({
      noiseSuppression: settings.noiseSuppression ?? true,
      echoCancellation: settings.echoCancellation ?? true,
      autoGainControl: settings.autoGainControl ?? true,
    });
  }, [audioTrack]);

  const toggleProcessing = async (key: ProcessingKey) => {
    if (!audioTrack) return;
    const next = !processing[key];
    setProcessing(prev => ({ ...prev, [key]: next }));
    try {
      await audioTrack.applyConstraints({ [key]: next });
    } catch {
      // Constraint not supported mid-stream — revert to the actual setting
      const settings = audioTrack.getSettings();
      setProcessing(prev => ({ ...prev, [key]: settings[key] ?? prev[key] }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Primary microphone device */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">Microphone</h3>
        <Select value={selectedMicId ?? undefined} onValueChange={selectMic}>
          <SelectTrigger className="w-full text-xs">
            <SelectValue placeholder={audioDevices.some(d => d.label) ? 'Choose microphone' : 'Default microphone (enable camera once to list all)'} />
          </SelectTrigger>
          <SelectContent>
            {audioDevices.map((d, i) => (
              <SelectItem key={d.deviceId || i} value={d.deviceId} className="text-xs">
                {d.label || `Microphone ${i + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
          Your main voice source — switching applies immediately, even mid-stream.
        </p>
      </div>

      {/* Input Volume: live input meter + outgoing broadcast level */}
      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-foreground">Input Volume</span>
          <button
            onClick={toggleMic}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title={isMicOn ? 'Mute microphone' : 'Unmute microphone'}
          >
            {isMicOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>

        {/* Live incoming level meter */}
        {audioTrack ? (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">Live input</span>
              <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                {isMicOn ? `${inputLevel}%` : 'Muted'}
              </span>
            </div>
            <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-100"
                style={{
                  width: `${inputLevel}%`,
                  background: 'linear-gradient(90deg, hsl(var(--success)), hsl(var(--accent)), hsl(var(--destructive)))',
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 mb-1">
            <MicOff className="h-3.5 w-3.5" />
            Enable the camera to activate the microphone
          </div>
        )}

        {/* Outgoing broadcast level */}
        <Slider
          value={[volume]}
          onValueChange={([v]) => setVolume(v)}
          max={100}
          step={1}
          className="w-full"
          disabled={!isMicOn}
        />
        <div className="flex justify-between mt-2">
          <span className="text-[11px] text-muted-foreground font-mono">0</span>
          <span className="text-[11px] text-primary font-mono font-semibold">
            {isMicOn ? `${volume}%` : 'Muted'}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">100</span>
        </div>
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
          Live mic level above; the slider sets the microphone level in the
          outgoing broadcast mix.
        </p>
      </div>

      {/* Broadcast mic equalizer */}
      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-foreground">Equalizer</h3>
          <button
            onClick={resetEq}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Reset all bands to flat (0 dB)"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
        <EqSpectrum stream={cameraStream} eq={eqGains} fx={audioEffects} />
        <div className="grid grid-cols-4 gap-2 mt-3">
          {EQ_BANDS.map(band => (
            <EqBandControl
              key={band.key}
              label={band.label}
              range={band.range}
              value={eqGains[band.key]}
              onChange={db => setEqBand(band.key, db)}
            />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
          Shapes the broadcast mic — the spectrum above shows your voice after
          the EQ, so the bars react as you adjust the bands. Applies to the
          outgoing mix and recordings.
        </p>
      </div>

      {/* Additional mics */}
      <div className="border-t border-border pt-4 space-y-2">
        <h3 className="text-sm font-medium text-foreground">
          Additional Mics ({1 + extraMics.length}/{1 + MAX_EXTRA_MICS} sources)
        </h3>
        {extraMics.map((mic, i) => (
          <ExtraMicRow
            key={mic.id}
            mic={mic}
            index={i}
            audioDevices={audioDevices}
            onDevice={deviceId => setExtraMicDevice(mic.id, deviceId)}
            onVolume={v => setExtraMicVolume(mic.id, v)}
            onToggle={() => toggleExtraMic(mic.id)}
            onRemove={() => removeExtraMic(mic.id)}
          />
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={addExtraMic}
          disabled={extraMics.length >= MAX_EXTRA_MICS}
          className="w-full gap-2 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          {extraMics.length >= MAX_EXTRA_MICS ? 'Maximum 5 audio sources' : 'Add Mic Source'}
        </Button>
        <p className="text-[11px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
          <Radio className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Wireless systems like the <strong className="text-foreground">RØDE Wireless GO II</strong>{' '}
            (plug in the USB receiver) and the <strong className="text-foreground">Mevo remote
            mic</strong> (via Mevo webcam mode) appear here as microphones once connected.
            Each source mixes into the broadcast with its own level.
          </span>
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium text-foreground mb-3">Processing</h3>
        <div className="space-y-2">
          {(Object.keys(PROCESSING_LABELS) as ProcessingKey[]).map(key => (
            <div
              key={key}
              className="flex items-center justify-between py-1.5 px-2 rounded-md bg-secondary/30"
            >
              <span className="text-xs text-muted-foreground">{PROCESSING_LABELS[key]}</span>
              <Switch
                checked={processing[key]}
                onCheckedChange={() => toggleProcessing(key)}
                disabled={!audioTrack}
              />
            </div>
          ))}
        </div>
        {!audioTrack && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Available once the microphone is active.
          </p>
        )}
      </div>
    </div>
  );
}
