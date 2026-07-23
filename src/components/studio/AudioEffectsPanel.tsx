import { useEffect, useRef, useState } from 'react';
import { useStudio } from '@/contexts/StudioContext';
import { AUDIO_PRESETS, AUDIO_FX_PARAMS } from '@/lib/audioEffects';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Sparkles, RotateCcw, Upload, Plus, X, AudioWaveform } from 'lucide-react';

// ── VST rack ──
// Imported plugin files, capped at VST_MAX. Note: browsers can't execute
// native VST binaries, so the rack stores and lists them (metadata persists
// across sessions) but they don't process the live audio chain.
const VST_MAX = 5;
const VST_KEY = 'studio-vst-rack';
const VST_FILE_RE = /\.(vst|vst3|component|dll|clap)$/i;

interface VstPlugin {
  id: string;
  name: string;
  size: number;
}

function loadVstRack(): VstPlugin[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(VST_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is VstPlugin =>
        typeof p?.id === 'string' && typeof p?.name === 'string' && typeof p?.size === 'number')
      .slice(0, VST_MAX);
  } catch {
    return [];
  }
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Human-readable value for a knob, collapsing bypass extremes to "Off". */
function formatValue(param: (typeof AUDIO_FX_PARAMS)[number], value: number): string {
  if (param.offAt !== undefined && value === param.offAt) return 'Off';
  if (param.unit === 'Hz' && value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} kHz`;
  return `${value}${param.unit === '%' ? '%' : ` ${param.unit}`}`;
}

const GROUP_ORDER = ['Filters', 'Dynamics', 'Reverb', 'Delay'] as const;

export function AudioEffectsPanel() {
  const { audioEffects, setAudioEffect, applyAudioPreset, toggleAudioEffects, resetAudioEffects } = useStudio();
  const activePreset = AUDIO_PRESETS.find(p => p.id === audioEffects.preset);
  const enabled = audioEffects.enabled;

  // VST rack (see constants above)
  const [vstRack, setVstRack] = useState<VstPlugin[]>(loadVstRack);
  const [vstError, setVstError] = useState<string | null>(null);
  const vstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { localStorage.setItem(VST_KEY, JSON.stringify(vstRack)); }
    catch { /* storage unavailable — rack just won't persist */ }
  }, [vstRack]);

  const handleVstFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    setVstError(null);

    const invalid = files.filter(f => !VST_FILE_RE.test(f.name));
    if (invalid.length) {
      setVstError(`Not a VST plugin file: ${invalid[0].name} (expected .vst, .vst3, .component, .dll, or .clap)`);
      return;
    }
    setVstRack(prev => {
      const room = VST_MAX - prev.length;
      if (files.length > room) {
        setVstError(`Plugin rack is limited to ${VST_MAX} — ${room > 0 ? `only ${room} more fit` : 'remove one first'}.`);
      }
      const added = files.slice(0, Math.max(0, room)).map(f => ({
        id: crypto.randomUUID(), name: f.name, size: f.size,
      }));
      return [...prev, ...added];
    });
  };

  return (
    <div className="border-t border-border pt-4 space-y-4">
      {/* Header + master enable */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
          Audio Effects
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={resetAudioEffects}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Reset effects to off"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <Switch checked={enabled} onCheckedChange={toggleAudioEffects} />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        VST-style processing on your microphone — applies to the live broadcast
        and to recordings. Pick a preset or dial in your own chain.
      </p>

      {/* Preset bank */}
      <div className="grid grid-cols-2 gap-1.5">
        {AUDIO_PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => applyAudioPreset(p.id)}
            className={`px-2.5 py-2 rounded-md text-[11px] font-medium text-left transition-colors ${
              audioEffects.preset === p.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
            title={p.description}
          >
            {p.label}
          </button>
        ))}
      </div>

      {activePreset && activePreset.id !== 'custom' && (
        <p className="text-[11px] text-muted-foreground leading-relaxed -mt-1">
          {activePreset.description}
        </p>
      )}
      {audioEffects.preset === 'custom' && (
        <p className="text-[11px] text-primary leading-relaxed -mt-1">Custom chain</p>
      )}

      {/* Parameter groups */}
      <div className={`space-y-4 transition-opacity ${enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        {GROUP_ORDER.map(group => (
          <div key={group} className="space-y-2.5">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{group}</span>
            {AUDIO_FX_PARAMS.filter(p => p.group === group).map(param => {
              const value = audioEffects[param.key] as number;
              return (
                <div key={param.key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground">{param.label}</span>
                    <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                      {formatValue(param, value)}
                    </span>
                  </div>
                  <Slider
                    value={[value]}
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    onValueChange={([v]) => setAudioEffect(param.key, v)}
                    disabled={!enabled}
                    className="w-full"
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* VST plugin rack */}
      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <AudioWaveform className="h-3.5 w-3.5" /> VST Plugins
          </span>
          <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{vstRack.length}/{VST_MAX}</span>
        </div>

        <input
          ref={vstInputRef}
          type="file"
          accept=".vst,.vst3,.component,.dll,.clap"
          multiple
          onChange={handleVstFiles}
          className="hidden"
        />

        {vstRack.length > 0 && (
          <div className="space-y-1">
            {vstRack.map(p => (
              <div key={p.id} className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-2.5 py-1.5">
                <span className="text-xs text-foreground truncate flex-1" title={p.name}>{p.name}</span>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">{formatSize(p.size)}</span>
                <button
                  onClick={() => setVstRack(prev => prev.filter(x => x.id !== p.id))}
                  className="p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  title={`Remove ${p.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {vstRack.length === 0 ? (
          <Button size="sm" variant="outline" onClick={() => vstInputRef.current?.click()} className="w-full gap-2">
            <Upload className="h-3.5 w-3.5" /> Import VST
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => vstInputRef.current?.click()}
            disabled={vstRack.length >= VST_MAX}
            className="w-full gap-2"
          >
            <Plus className="h-3.5 w-3.5" />
            {vstRack.length >= VST_MAX ? `Rack full (${VST_MAX} max)` : `Add VST (${vstRack.length}/${VST_MAX})`}
          </Button>
        )}

        {vstError && <p className="text-[11px] text-destructive leading-relaxed">{vstError}</p>}

        <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
          Browsers can't run native VST binaries yet — imported plugins are kept
          in your rack, but the live chain uses the built-in effects above.
        </p>
      </div>
    </div>
  );
}
