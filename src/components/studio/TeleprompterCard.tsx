import { useRef, useState } from 'react';
import { ScrollText, Eye, EyeOff, Play, Pause, RotateCcw, Mic, Cpu, Zap, Activity, Plus, FileText, X, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useTeleprompter } from '@/contexts/TeleprompterContext';
import { useToast } from '@/hooks/use-toast';

/** Saved-document quick-load slots + file import (.txt / PDF). */
function DocumentBar() {
  const { documents, importDocument, loadDocument, removeDocument, saveCurrentDocument, script } = useTeleprompter();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const full = documents.length >= 4;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be picked again later
    if (!file) return;
    setBusy(true);
    try {
      await importDocument(file);
      toast({ title: 'Script imported', description: file.name });
    } catch (err) {
      toast({ title: 'Couldn’t import that file', description: String(err instanceof Error ? err.message : err), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground">Documents</span>
        <div className="flex items-center gap-1">
          <Button
            size="sm" variant="ghost" title="Save current text as a document"
            className="h-6 gap-1 px-1.5 text-[10px]"
            disabled={!script.trim() || full}
            onClick={() => saveCurrentDocument()}
          >
            <Save className="h-3 w-3" /> Save
          </Button>
          <Button
            size="sm" variant="outline" title={full ? 'Remove one to add another (max 4)' : 'Import a .txt or PDF file'}
            className="h-6 gap-1 px-1.5 text-[10px]"
            disabled={busy || full}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add
          </Button>
          <input
            ref={fileRef} type="file" accept=".txt,.md,.markdown,.text,text/plain,application/pdf,.pdf"
            className="hidden" onChange={onFile}
          />
        </div>
      </div>
      {documents.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/70 leading-tight">
          Import a .txt or PDF, or save your current text — up to 4 for one-tap loading.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {documents.map(d => (
            <span key={d.id} className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/50 pl-1.5 pr-0.5 py-0.5 text-[10px]">
              <button
                className="inline-flex items-center gap-1 max-w-[130px] truncate text-foreground hover:text-primary"
                title={`Load “${d.name}”`}
                onClick={() => loadDocument(d.id)}
              >
                <FileText className="h-3 w-3 shrink-0" /><span className="truncate">{d.name}</span>
              </button>
              <button
                className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                title="Delete" onClick={() => removeDocument(d.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact label + switch row for a voice-follow mode toggle. */
function ToggleRow({ icon, label, hint, checked, onChange }: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <span className="flex items-center gap-1.5 text-xs text-foreground">{icon}{label}</span>
        <p className="text-[10px] text-muted-foreground/80 leading-tight">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="shrink-0" />
    </div>
  );
}

/** Slider row with a label and current-value readout. */
function SliderRow({ label, value, min, max, step = 1, suffix, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{value}{suffix}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}

/**
 * Teleprompter controls — first card in Pro Control. Drives the host-only
 * overlay layered on the video preview (never composited into the broadcast).
 */
export function TeleprompterCard() {
  const {
    script, setScript, visible, setVisible,
    opacity, setOpacity, fontSize, setFontSize, scrollSpeed, setScrollSpeed,
    mode, speechError, status, wordIndex, words, start, pause, reset,
    engine, modelStatus, modelProgress, listening, micLevel, micLabel,
    voiceHopMs, setVoiceHopMs, voiceContextMs, setVoiceContextMs,
    voiceAdaptive, setVoiceAdaptive, voiceUseGpu, setVoiceUseGpu, voiceStats,
  } = useTeleprompter();

  const running = status === 'running';
  const total = words.length;

  // Human-readable engine/status label for the badge.
  let badge: string;
  if (mode === 'auto') badge = 'Auto-scroll';
  else if (engine === 'whisper') {
    badge = modelStatus === 'loading'
      ? `Loading voice model… ${modelProgress}%`
      : modelStatus === 'ready' ? 'On-device voice' : 'On-device voice';
  } else badge = 'Voice follow';

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-medium text-foreground">Teleprompter</span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        A script overlay only you can see — never shown to viewers or in
        recordings. It scrolls as you read aloud.
      </p>

      <DocumentBar />

      <Textarea
        value={script}
        onChange={e => setScript(e.target.value)}
        placeholder="Paste or type your script…"
        className="min-h-[80px] text-xs bg-background/60"
      />

      {/* Mode/engine badge + show/hide */}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
          {running && listening && (
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-live" />
          )}
          {badge}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setVisible(!visible)}
          className="h-7 gap-1.5 text-[11px]"
        >
          {visible
            ? <><EyeOff className="h-3 w-3" /> Hide</>
            : <><Eye className="h-3 w-3" /> Show</>}
        </Button>
      </div>

      {/* Model download progress (first use of the on-device engine). */}
      {engine === 'whisper' && modelStatus === 'loading' && (
        <div className="space-y-1">
          <div className="h-1 w-full overflow-hidden rounded bg-secondary">
            <div className="h-full bg-primary transition-all" style={{ width: `${modelProgress}%` }} />
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Downloading the on-device voice model once (~65 MB) — it's cached for next time.
          </p>
        </div>
      )}

      {/* Mic indicator + live input meter — shows which mic is captured and
          that your voice is being heard (only the Whisper engine exposes a
          level; Web Speech doesn't). */}
      {running && engine === 'whisper' && micLabel && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
            <Mic className={`h-3 w-3 shrink-0 ${micLevel > 8 ? 'text-primary' : ''}`} />
            <span className="truncate" title={micLabel}>{micLabel}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-secondary">
            <div
              className={`h-full rounded transition-[width] duration-75 ${micLevel > 8 ? 'bg-primary' : 'bg-muted-foreground/40'}`}
              style={{ width: `${micLevel}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground/80 leading-relaxed">
            {micLevel > 8 ? 'Hearing you — read aloud and it will follow.' : 'Speak — if this bar stays flat, check your mic.'}
          </p>
        </div>
      )}

      {running && listening && engine !== 'whisper' && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Listening — read your script aloud and it will follow.
        </p>
      )}

      {speechError && (
        <p className="text-[11px] text-destructive leading-relaxed">{speechError}</p>
      )}

      {/* Sliders */}
      <SliderRow label="Opacity" value={opacity} min={0} max={100} suffix="%" onChange={setOpacity} />
      <SliderRow label="Text size" value={fontSize} min={18} max={48} suffix="px" onChange={setFontSize} />
      {mode === 'auto' && (
        <SliderRow label="Scroll speed" value={scrollSpeed} min={10} max={120} suffix=" px/s" onChange={setScrollSpeed} />
      )}

      {/* On-device voice-follow tuning — only the Whisper engine (Brave/Safari/
          Firefox) exposes this trade-off; applies live, no restart needed. */}
      {engine === 'whisper' && (
        <div className="space-y-2.5 rounded-md border border-border/60 bg-background/40 p-2.5">
          <p className="text-[11px] font-medium text-foreground">Voice follow tuning</p>

          {/* Live latency + health readout (populates after the first pass). */}
          {running && voiceStats && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                  <Activity className="h-3 w-3" /> Inference
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    voiceStats.behind
                      ? 'bg-destructive/15 text-destructive'
                      : 'bg-primary/10 text-primary'
                  }`}
                >
                  {voiceStats.behind ? 'Falling behind' : 'Keeping up'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                <span className="inline-flex items-center gap-1">
                  {voiceStats.device === 'webgpu'
                    ? <><Zap className="h-3 w-3 text-primary" /> GPU</>
                    : <><Cpu className="h-3 w-3" /> CPU</>}
                </span>
                <span>avg {voiceStats.avgMs} ms · peak {voiceStats.maxMs} ms</span>
              </div>
              {/* The number that actually governs lag: how often it advances. */}
              <div className="flex items-center justify-between text-[10px] tabular-nums">
                <span className="text-muted-foreground">Following at</span>
                <span className="font-medium text-foreground">
                  {voiceStats.effHopMs} ms{voiceAdaptive ? ' · auto' : ''}
                </span>
              </div>
              {voiceAdaptive && voiceStats.effContextMs < voiceContextMs - 50 && (
                <p className="text-[10px] text-muted-foreground/70 leading-tight">
                  Auto-stabilizing: context trimmed to {voiceStats.effContextMs} ms to keep up.
                </p>
              )}
            </div>
          )}

          <ToggleRow
            icon={<Activity className="h-3 w-3" />}
            label="Auto-stabilize"
            hint="Auto-tunes latency & context — snappiest that keeps up"
            checked={voiceAdaptive}
            onChange={setVoiceAdaptive}
          />
          <ToggleRow
            icon={<Zap className="h-3 w-3" />}
            label="Use GPU (experimental)"
            hint="Try WebGPU; falls back to CPU if unsupported"
            checked={voiceUseGpu}
            onChange={setVoiceUseGpu}
          />

          <SliderRow
            label={voiceAdaptive ? 'Max latency' : 'Follow latency'}
            value={voiceHopMs} min={300} max={1200} step={50} suffix=" ms"
            onChange={setVoiceHopMs}
          />
          <SliderRow
            label="Recognition context"
            value={voiceContextMs} min={800} max={2500} step={100} suffix=" ms"
            onChange={setVoiceContextMs}
          />
          <p className="text-[10px] text-muted-foreground/80 leading-relaxed">
            {voiceAdaptive
              ? 'With Auto-stabilize on, latency is set for you (the slider is just a ceiling). More context is more accurate but heavier.'
              : 'Lower latency follows your words sooner; more context is more accurate but heavier. Defaults: 450 / 1400 ms.'}
          </p>
        </div>
      )}

      {/* Transport */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={running ? pause : start}
          className="h-7 flex-1 gap-1.5 text-[11px]"
        >
          {running
            ? <><Pause className="h-3 w-3" /> Pause</>
            : <><Play className="h-3 w-3" /> Start</>}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={reset}
          className="h-7 gap-1.5 text-[11px]"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </Button>
      </div>

      {total > 0 && (
        <p className="text-[11px] text-muted-foreground tabular-nums">
          Word {Math.min(wordIndex + 1, total)} / {total}
        </p>
      )}
    </div>
  );
}
