import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '@/contexts/StudioContext';
import {
  checkHyperframes, generateMotionGraphic, HYPERFRAMES_ENDPOINT,
  MOTION_SIZES, MOTION_TEMPLATES, MOTION_ENTERS, MOTION_EXITS, MOTION_BORDERS, MOTION_FONTS, PHASE_LABEL,
  type HyperframesHealth, type MotionFormat, type MotionMode, type MotionPhase, type MotionOption,
} from '@/lib/hyperframes';
import {
  listMotionLibrary, saveMotionGraphic, deleteMotionGraphic, getMotionUrl, getMotionFile,
  MOTION_LIBRARY_SLOTS, type MotionLibraryItem,
} from '@/lib/motionLibrary';
import { addMotionGraphicToEditorBin } from '@/lib/editorStock';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import {
  Wand2, LayoutTemplate, Sparkles, Loader2, ImagePlus, Clapperboard,
  PlugZap, RefreshCw, Trash2, Film, SlidersHorizontal, ChevronDown, type LucideIcon,
} from 'lucide-react';

/** What a generated graphic is (handed to host actions with the File). */
export interface MotionResultMeta {
  prompt: string;
  format: MotionFormat;
  width: number;
  height: number;
  duration: number;
  /** Motion Library asset id, once saved — lets actions persist references
   * (e.g. a logo overlay that survives refresh). */
  libraryId?: string;
}

/** One "use this" button under the finished render. The host owns what
 * happens to the file (overlay / library / media bin / download). */
export interface MotionAction {
  key: string;
  icon: LucideIcon;
  label: string;
  title: string;
  run: (file: File, meta: MotionResultMeta) => Promise<void> | void;
}

/** Alpha-checkerboard backdrop so a transparent WebM reads as transparent. */
const CHECKER_BG = {
  background: 'repeating-conic-gradient(hsl(var(--secondary)) 0% 25%, hsl(var(--background)) 0% 50%) 0 0 / 16px 16px',
} as const;

interface Result {
  file: File;
  url: string;
  meta: MotionResultMeta;
}

/** A compact labelled dropdown for one animation / style knob. */
function KnobSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: MotionOption[];
}) {
  return (
    <label className="space-y-1 block">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(o => (
            <SelectItem key={o.id} value={o.id} className="text-xs">{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/** One saved render in the shared library (below the generator). Host actions
 * get the re-materialized File, so "use this" behaves exactly like a fresh
 * render. */
function MotionLibraryRow({ item, actions, busy, onRun, onDelete }: {
  item: MotionLibraryItem;
  actions: MotionAction[];
  /** Key of the action running for THIS item, 'delete', or null. */
  busy: string | null;
  onRun: (action: MotionAction, item: MotionLibraryItem) => void;
  onDelete: (item: MotionLibraryItem) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getMotionUrl(item.id).then(u => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [item.id]);

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div style={CHECKER_BG}>
        {url ? (
          <video src={url} preload="metadata" muted playsInline controls className="w-full max-h-32 object-contain" />
        ) : (
          <div className="h-16 flex items-center justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="p-2 space-y-1.5 bg-secondary/30">
        <p className="text-[11px] text-foreground leading-tight truncate" title={item.prompt}>{item.prompt}</p>
        <p className="text-[10px] text-muted-foreground">
          {item.width}×{item.height} · {item.duration}s · {item.format === 'webm' ? 'transparent WebM' : 'MP4'} ·{' '}
          {new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </p>
        <div className="flex gap-1 flex-wrap">
          {actions.map(a => {
            const Icon = a.icon;
            return (
              <Button
                key={a.key} size="sm" variant="outline"
                className="h-6 gap-1 text-[10px] px-2"
                disabled={busy !== null}
                onClick={() => onRun(a, item)}
                title={a.title}
              >
                {busy === a.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                {a.label}
              </Button>
            );
          })}
          <Button
            size="sm" variant="outline"
            className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-destructive"
            disabled={busy !== null}
            onClick={() => onDelete(item)}
            title="Delete from library"
          >
            {busy === 'delete' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Presentational motion-graphics generator: prompt → template or AI
 * composition → rendered video, with host-supplied result actions. Shared by
 * the Studio side panel and the Video Editor sheet. */
export function MotionGraphicsBrowser({ actions }: { actions: MotionAction[] }) {
  const { toast } = useToast();

  // undefined = probing, null = unreachable
  const [health, setHealth] = useState<HyperframesHealth | null | undefined>(undefined);
  const probe = useCallback(async () => {
    setHealth(undefined);
    setHealth(await checkHyperframes());
  }, []);
  useEffect(() => { void probe(); }, [probe]);

  const [mode, setMode] = useState<MotionMode>('template');
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState(MOTION_TEMPLATES[0].id);
  const [sizeId, setSizeId] = useState(MOTION_SIZES[0].id);
  const [duration, setDuration] = useState(5);
  const [accent, setAccent] = useState('#06b4e0');
  const [format, setFormat] = useState<MotionFormat>('webm');

  // Animation & style knobs.
  const [enter, setEnter] = useState('auto');
  const [exit, setExit] = useState('auto');
  const [border, setBorder] = useState('none');
  const [font, setFont] = useState('auto');
  const [secondary, setSecondary] = useState('#ffffff');
  const [logoText, setLogoText] = useState('');
  const [styleOpen, setStyleOpen] = useState(false);

  const [phase, setPhase] = useState<MotionPhase | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Shared library of past renders (Studio + Editor write to the same store).
  const [library, setLibrary] = useState<MotionLibraryItem[] | null>(null);
  const [libBusy, setLibBusy] = useState<{ id: string; key: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    listMotionLibrary()
      .then(items => { if (!cancelled) setLibrary(items); })
      .catch(() => { if (!cancelled) setLibrary([]); });
    return () => { cancelled = true; };
  }, []);

  // The render's object URL outlives renders of this component tree only.
  const resultUrl = useRef<string | null>(null);
  useEffect(() => () => { if (resultUrl.current) URL.revokeObjectURL(resultUrl.current); }, []);

  const generating = phase !== null && phase !== 'done' && phase !== 'error';

  // One-line preview of the active knobs, shown on the collapsed header.
  const styleSummary = useMemo(() => {
    const lbl = (list: MotionOption[], id: string) => list.find(o => o.id === id)?.label;
    const parts: string[] = [];
    if (enter !== 'auto') parts.push(lbl(MOTION_ENTERS, enter)!);
    if (border !== 'none') parts.push(lbl(MOTION_BORDERS, border)!);
    if (font !== 'auto') parts.push(lbl(MOTION_FONTS, font)!);
    return parts.length ? parts.join(' · ') : 'Auto';
  }, [enter, border, font]);

  const onGenerate = useCallback(async () => {
    const size = MOTION_SIZES.find(s => s.id === sizeId) ?? MOTION_SIZES[0];
    setError(null);
    setPhase('queued');
    setProgress(0);
    try {
      const file = await generateMotionGraphic(
        {
          prompt: prompt.trim(), mode, template, format,
          width: size.width, height: size.height, duration, accentColor: accent,
          // Style knobs only apply to template mode; AI mode authors its own look.
          ...(mode === 'template' ? {
            secondaryColor: secondary, enter, exit, border, font,
            logoText: logoText.trim() || undefined,
          } : {}),
        },
        (p, pct) => { setPhase(p); setProgress(pct); },
      );
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
      const url = URL.createObjectURL(file);
      resultUrl.current = url;
      setResult({
        file, url,
        meta: { prompt: prompt.trim(), format, width: size.width, height: size.height, duration },
      });
      setPhase('done');
      // Auto-save every render to the shared library. Non-fatal: the render
      // itself stays usable even if saving fails (e.g. signed out).
      try {
        const saved = await saveMotionGraphic(file, {
          prompt: prompt.trim(), mode, template: mode === 'template' ? template : undefined,
          format, width: size.width, height: size.height, duration,
        });
        setLibrary(saved.list);
        setResult(prev => (prev && prev.url === url
          ? { ...prev, meta: { ...prev.meta, libraryId: saved.item.id } }
          : prev));
        if (saved.evicted > 0) {
          toast({
            title: 'Library full',
            description: `Removed the oldest render to stay within ${MOTION_LIBRARY_SLOTS} slots.`,
          });
        }
      } catch {
        toast({
          title: 'Not saved to library',
          description: 'The render works, but saving it needs a signed-in account.',
        });
      }
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Render failed');
    }
  }, [prompt, mode, template, format, sizeId, duration, accent, secondary, enter, exit, border, font, logoText, toast]);

  const runAction = useCallback(async (action: MotionAction, res: Result) => {
    setBusyAction(action.key);
    try {
      await action.run(res.file, res.meta);
    } catch (err) {
      toast({
        title: 'Action failed',
        description: err instanceof Error ? err.message : 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  }, [toast]);

  // Library rows re-materialize the stored blob, then run the same host action.
  const runLibraryAction = useCallback(async (action: MotionAction, item: MotionLibraryItem) => {
    setLibBusy({ id: item.id, key: action.key });
    try {
      const file = await getMotionFile(item);
      await action.run(file, {
        prompt: item.prompt, format: item.format,
        width: item.width, height: item.height, duration: item.duration,
        libraryId: item.id,
      });
    } catch (err) {
      toast({
        title: 'Action failed',
        description: err instanceof Error ? err.message : 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setLibBusy(null);
    }
  }, [toast]);

  const deleteLibraryItem = useCallback(async (item: MotionLibraryItem) => {
    setLibBusy({ id: item.id, key: 'delete' });
    try {
      await deleteMotionGraphic(item.id);
      setLibrary(prev => (prev ?? []).filter(i => i.id !== item.id));
    } catch (err) {
      toast({
        title: 'Could not delete',
        description: err instanceof Error ? err.message : 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setLibBusy(null);
    }
  }, [toast]);

  // Shared library — every render from the Studio or the Video Editor. Shown
  // even while the render service is offline: saved items stay usable.
  const librarySection = (
    <div className="pt-1 space-y-2">
      <div className="flex items-center gap-1.5">
        <Film className="h-3 w-3 text-muted-foreground" />
        <h3 className="text-[11px] font-semibold text-foreground">Library</h3>
        {library !== null && (
          <span className="text-[10px] text-muted-foreground">({library.length}/{MOTION_LIBRARY_SLOTS} slots)</span>
        )}
      </div>
      {library === null && (
        <div className="flex items-center justify-center gap-2 py-4 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}
      {library?.length === 0 && (
        <p className="text-[11px] text-muted-foreground/60 text-center py-4">
          Generated motion graphics from the Studio and the Video Editor are
          saved here automatically.
        </p>
      )}
      {!!library?.length && (
        <div className="space-y-2">
          {library.map(item => (
            <MotionLibraryRow
              key={item.id}
              item={item}
              actions={actions}
              busy={libBusy?.id === item.id ? libBusy.key : null}
              onRun={(a, i) => void runLibraryAction(a, i)}
              onDelete={i => void deleteLibraryItem(i)}
            />
          ))}
        </div>
      )}
    </div>
  );

  // ---- service unreachable / probing ----
  if (health === undefined) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking render service…
      </div>
    );
  }
  if (health === null) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-border bg-secondary/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-foreground">
            <PlugZap className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold">Render service offline</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Motion graphics are rendered by the HyperFrames service, which isn't
            responding at <span className="font-mono">{HYPERFRAMES_ENDPOINT}</span>.
            {HYPERFRAMES_ENDPOINT.startsWith('/') ? (
              <> Start it with <span className="font-mono">npm start</span> in{' '}
              <span className="font-mono">hyperframes-service/</span>.</>
            ) : (
              <> Check the <span className="font-mono">hyperframes-service</span>{' '}
              deployment (it may still be starting up).</>
            )}
          </p>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => void probe()}>
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        </div>
        {librarySection}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Tabs value={mode} onValueChange={v => setMode(v as MotionMode)}>
        <TabsList className="grid w-full grid-cols-2 h-8">
          <TabsTrigger value="template" className="text-xs gap-1">
            <LayoutTemplate className="h-3 w-3" /> Templates
          </TabsTrigger>
          <TabsTrigger value="llm" className="text-xs gap-1" disabled={!health.llm}
            title={health.llm ? undefined : 'AI mode needs an ANTHROPIC_API_KEY on the render service'}>
            <Sparkles className="h-3 w-3" /> AI
          </TabsTrigger>
        </TabsList>

        <TabsContent value="template" className="mt-3 space-y-2">
          {MOTION_TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => setTemplate(t.id)}
              className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                template === t.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-secondary/30 hover:border-primary/40'
              }`}
            >
              <p className="text-xs font-medium text-foreground">{t.name}</p>
              <p className="text-[10px] text-muted-foreground">{t.hint}</p>
            </button>
          ))}
        </TabsContent>
        <TabsContent value="llm" className="mt-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Claude designs a one-off animated composition from your prompt —
            describe the motion, mood, and text you want on screen.
          </p>
        </TabsContent>
      </Tabs>

      <Textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder={mode === 'template'
          ? 'Headline | Subtitle — e.g. "Jane Doe | Lead Engineer"'
          : 'e.g. "Neon countdown sting: WE\'RE LIVE bursts in with electric sparks"'}
        className="text-xs min-h-[64px]"
        maxLength={2000}
      />

      <div className="grid grid-cols-2 gap-2">
        <Select value={sizeId} onValueChange={setSizeId}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MOTION_SIZES.map(s => (
              <SelectItem key={s.id} value={s.id} className="text-xs">{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={format} onValueChange={v => setFormat(v as MotionFormat)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="webm" className="text-xs">Transparent (WebM)</SelectItem>
            <SelectItem value="mp4" className="text-xs">Opaque (MP4)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2">
          <Slider
            value={[duration]}
            onValueChange={([v]) => setDuration(v)}
            min={2} max={15} step={1}
            className="flex-1"
            aria-label="Duration in seconds"
          />
          <span className="text-[10px] font-mono text-muted-foreground w-6 text-right tabular-nums">{duration}s</span>
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer" title="Accent color">
          <input
            type="color"
            value={accent}
            onChange={e => setAccent(e.target.value)}
            className="h-6 w-8 rounded border border-border bg-transparent cursor-pointer"
            aria-label="Accent color"
          />
          Accent
        </label>
      </div>

      {mode === 'template' && (
        <Collapsible open={styleOpen} onOpenChange={setStyleOpen} className="rounded-md border border-border bg-secondary/20">
          <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-foreground">
            <SlidersHorizontal className="h-3 w-3 text-muted-foreground shrink-0" />
            Animation &amp; Style
            <span className="ml-auto text-[10px] text-muted-foreground truncate max-w-[52%] text-right">{styleSummary}</span>
            <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${styleOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-2.5 pb-2.5 pt-1 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <KnobSelect label="Entrance" value={enter} onChange={setEnter} options={MOTION_ENTERS} />
              <KnobSelect label="Exit" value={exit} onChange={setExit} options={MOTION_EXITS} />
              <KnobSelect label="Font" value={font} onChange={setFont} options={MOTION_FONTS} />
              <KnobSelect label="Border" value={border} onChange={setBorder} options={MOTION_BORDERS} />
            </div>
            <div className="flex items-center gap-3">
              <label
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer shrink-0"
                title="Secondary colour — rotating-gradient border and glitch channels"
              >
                <input
                  type="color"
                  value={secondary}
                  onChange={e => setSecondary(e.target.value)}
                  className="h-6 w-8 rounded border border-border bg-transparent cursor-pointer"
                  aria-label="Secondary color"
                />
                2nd colour
              </label>
              {template === 'news-lower-third' && (
                <Input
                  value={logoText}
                  onChange={e => setLogoText(e.target.value)}
                  placeholder="Logo / bug — e.g. NEWS"
                  maxLength={24}
                  className="h-7 text-xs flex-1"
                  aria-label="Logo bug text"
                />
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <Button
        size="sm"
        className="w-full h-8 gap-1.5 text-xs"
        disabled={generating || !prompt.trim()}
        onClick={() => void onGenerate()}
      >
        {generating
          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {PHASE_LABEL[phase]}</>
          : <><Wand2 className="h-3.5 w-3.5" /> Generate</>}
      </Button>

      {generating && <Progress value={Math.round(progress * 100)} className="h-1.5" />}

      {error && (
        <p className="text-xs text-destructive leading-relaxed" role="alert">
          {error}
        </p>
      )}

      {result && !generating && (
        <div className="rounded-md border border-border overflow-hidden">
          <div style={CHECKER_BG}>
            <video
              key={result.url}
              src={result.url}
              autoPlay loop muted playsInline controls
              className="w-full max-h-48 object-contain"
            />
          </div>
          <div className="p-2 space-y-1.5 bg-secondary/30">
            <p className="text-[11px] text-foreground leading-tight truncate" title={result.meta.prompt}>
              {result.meta.prompt}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {result.meta.width}×{result.meta.height} · {result.meta.duration}s ·{' '}
              {result.meta.format === 'webm' ? 'transparent WebM' : 'MP4'}
            </p>
            <div className="flex gap-1 flex-wrap">
              {actions.map(a => {
                const Icon = a.icon;
                return (
                  <Button
                    key={a.key} size="sm" variant="outline"
                    className="h-6 gap-1 text-[10px] px-2"
                    disabled={busyAction !== null}
                    onClick={() => void runAction(a, result)}
                    title={a.title}
                  >
                    {busyAction === a.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                    {a.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
        Transparent WebM composites over the stream and timeline (Chromium
        only). Use MP4 for an opaque clip that plays anywhere.
      </p>

      {librarySection}
    </div>
  );
}

/** Studio right-panel "Motion Graphics": generate a graphic, then use it as a
 * live broadcast overlay, save it to the cloud Video Library, or download. */
export function MotionGraphicsPanel() {
  const { addControlRoomSource } = useStudio();
  const { toast } = useToast();

  const actions: MotionAction[] = useMemo(() => [
    {
      key: 'overlay', icon: ImagePlus, label: 'Add to Control Room',
      title: 'Add it as a source button in the Control Room (up to 20) and put it live over the video',
      run: (file, meta) => {
        const added = addControlRoomSource({
          file, kind: 'video', libraryId: meta.libraryId,
          name: meta.prompt.slice(0, 24),
        });
        toast(added
          ? { title: 'Added to Control Room', description: 'It’s on air — manage it in the Control Room panel.' }
          : { title: 'Control Room full', description: 'Remove a source button first (max 20).' });
      },
    },
    {
      key: 'editor', icon: Clapperboard, label: 'Add to Video Editor',
      title: "Add it to the Video Editor's Media panel (Videos) — trimmable and exportable like any clip",
      run: async (file, meta) => {
        await addMotionGraphicToEditorBin(file, meta);
        toast({ title: 'Added to Video Editor', description: 'Find it under Media → Videos in the Video Editor as “Motion”.' });
      },
    },
  ], [addControlRoomSource, toast]);

  return <MotionGraphicsBrowser actions={actions} />;
}
