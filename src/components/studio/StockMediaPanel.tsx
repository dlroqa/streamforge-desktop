import { useCallback, useMemo, useRef, useState } from 'react';
import { useStudio } from '@/contexts/StudioContext';
import {
  searchStockPhotos, searchStockAudio, searchStockVideos,
  fetchStockFile, downloadFile, type StockItem, type StockKind,
} from '@/lib/stockMedia';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  Search, Loader2, Download, ImagePlus, CloudUpload, ExternalLink,
  Image as ImageIcon, Music, Film, Clapperboard, Images, Volume2, type LucideIcon,
} from 'lucide-react';
import { ExcerptsLibrary } from './ExcerptsLibrary';
import { SoundFxPanel } from '@/components/editor/SoundFxPanel';
import { downloadSound, type FreesoundSound } from '@/lib/freesound';

function formatDuration(s?: number): string | null {
  if (!s || !Number.isFinite(s)) return null;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** One action button under a stock result. `run` receives the fetched (blob)
 * File so the host can drop it into whatever pipeline it owns. */
export interface StockItemAction {
  key: string;
  icon: LucideIcon;
  /** Shown next to the icon; omit for a compact icon-only square button. */
  label?: string;
  title: string;
  /** Stretch to fill the row (the primary action). */
  fullWidth?: boolean;
  run: (file: File, item: StockItem) => Promise<void> | void;
}

/** Per-kind action sets — lets the studio and the editor host the same browser
 * with different "use this" behaviours. */
export type StockActions = Record<StockKind, StockItemAction[]>;

/** Creator + license line every result shows (CC BY requires attribution). */
function Attribution({ item }: { item: StockItem }) {
  return (
    <p className="text-[10px] text-muted-foreground leading-snug truncate">
      {item.creator} ·{' '}
      {item.licenseUrl ? (
        <a href={item.licenseUrl} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
          {item.license}
        </a>
      ) : item.license}
      {' · '}
      <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-foreground inline-flex items-center gap-0.5">
        source<ExternalLink className="h-2.5 w-2.5" />
      </a>
    </p>
  );
}

function ActionButton({ action, item, busy, onRun }: {
  action: StockItemAction; item: StockItem; busy: boolean;
  onRun: (action: StockItemAction, item: StockItem) => void;
}) {
  const Icon = action.icon;
  const cls = !action.label
    ? 'h-6 w-6 p-0 shrink-0'
    : action.fullWidth
      ? 'h-6 flex-1 gap-1 text-[10px] px-1'
      : 'h-6 gap-1 text-[10px] px-2 shrink-0';
  return (
    <Button size="sm" variant="outline" className={cls} disabled={busy} onClick={() => onRun(action, item)} title={action.title}>
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      {action.label}
    </Button>
  );
}

const SEARCHERS: Record<StockKind, (q: string, signal?: AbortSignal) => Promise<StockItem[]>> = {
  photo: searchStockPhotos,
  audio: searchStockAudio,
  video: searchStockVideos,
};

const EMPTY_HINTS: Record<StockKind, string> = {
  photo: 'Search free CC-licensed photos (Openverse)',
  audio: 'Search free CC-licensed music & sounds (Openverse)',
  video: 'Search free CC-licensed videos (Wikimedia Commons)',
};

function StockTab({ kind, actions }: { kind: StockKind; actions: StockItemAction[] }) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSearching(true);
    try {
      const results = await SEARCHERS[kind](q, ctrl.signal);
      if (!ctrl.signal.aborted) setItems(results);
    } catch (err) {
      if (!ctrl.signal.aborted) {
        toast({
          title: 'Search failed',
          description: err instanceof Error ? err.message : 'Please try again',
          variant: 'destructive',
        });
      }
    } finally {
      if (!ctrl.signal.aborted) setSearching(false);
    }
  }, [kind, query, toast]);

  /** Fetch the item's file, run the chosen action, surface busy state + errors. */
  const runAction = useCallback(async (action: StockItemAction, item: StockItem) => {
    setBusyId(item.id);
    try {
      const file = await fetchStockFile(item);
      await action.run(file, item);
    } catch (err) {
      toast({
        title: 'Could not fetch file',
        description: err instanceof Error ? err.message : 'The source may block downloads — try its source page.',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  }, [toast]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
          placeholder={EMPTY_HINTS[kind]}
          className="text-xs h-8"
          maxLength={100}
        />
        <Button size="sm" onClick={runSearch} disabled={searching || !query.trim()} className="h-8 w-8 p-0 shrink-0">
          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {items === null && !searching && (
        <p className="text-xs text-muted-foreground/60 text-center py-8">{EMPTY_HINTS[kind]}</p>
      )}
      {items?.length === 0 && (
        <p className="text-xs text-muted-foreground/60 text-center py-8">No results — try different keywords.</p>
      )}

      {/* Photos: thumbnail grid */}
      {kind === 'photo' && !!items?.length && (
        <div className="grid grid-cols-2 gap-2">
          {items.map(item => (
            <div key={item.id} className="rounded-md border border-border overflow-hidden bg-secondary/30">
              <img src={item.thumbnail || item.url} alt={item.title} loading="lazy" className="w-full h-20 object-cover" />
              <div className="p-1.5 space-y-1">
                <p className="text-[11px] text-foreground leading-tight truncate" title={item.title}>{item.title}</p>
                <Attribution item={item} />
                <div className="flex gap-1">
                  {actions.map(a => (
                    <ActionButton key={a.key} action={a} item={item} busy={busyId === item.id} onRun={runAction} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Audio: rows with inline players */}
      {kind === 'audio' && !!items?.length && (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="rounded-md border border-border p-2 space-y-1.5 bg-secondary/30">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11px] text-foreground leading-tight truncate flex-1" title={item.title}>{item.title}</p>
                {formatDuration(item.duration) && (
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">{formatDuration(item.duration)}</span>
                )}
              </div>
              <audio controls preload="none" src={item.url} className="w-full h-8" />
              <Attribution item={item} />
              <div className="flex gap-1">
                {actions.map(a => (
                  <ActionButton key={a.key} action={a} item={item} busy={busyId === item.id} onRun={runAction} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Videos: rows with poster + inline player */}
      {kind === 'video' && !!items?.length && (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="rounded-md border border-border p-2 space-y-1.5 bg-secondary/30">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11px] text-foreground leading-tight truncate flex-1" title={item.title}>{item.title}</p>
                {formatDuration(item.duration) && (
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">{formatDuration(item.duration)}</span>
                )}
              </div>
              <video controls preload="none" src={item.url} poster={item.thumbnail} className="w-full rounded bg-black aspect-video" />
              <Attribution item={item} />
              <div className="flex gap-1">
                {actions.map(a => (
                  <ActionButton key={a.key} action={a} item={item} busy={busyId === item.id} onRun={runAction} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
        Free Creative-Commons media. Check each item's license — CC BY requires
        crediting the creator (attribution shown per item).
      </p>
    </div>
  );
}

/** Presentational stock browser: search & preview free photos/audio/videos.
 * The host supplies the per-kind actions (what "use this" does). */
export function StockMediaBrowser({ actions }: { actions: StockActions }) {
  return (
    <Tabs defaultValue="photo" className="w-full">
      <TabsList className="grid w-full grid-cols-3 h-8 mb-4">
        <TabsTrigger value="photo" className="text-xs gap-1"><ImageIcon className="h-3 w-3" />Photos</TabsTrigger>
        <TabsTrigger value="audio" className="text-xs gap-1"><Music className="h-3 w-3" />Audio</TabsTrigger>
        <TabsTrigger value="video" className="text-xs gap-1"><Film className="h-3 w-3" />Videos</TabsTrigger>
      </TabsList>
      <TabsContent value="photo" className="mt-0"><StockTab kind="photo" actions={actions.photo} /></TabsContent>
      <TabsContent value="audio" className="mt-0"><StockTab kind="audio" actions={actions.audio} /></TabsContent>
      <TabsContent value="video" className="mt-0"><StockTab kind="video" actions={actions.video} /></TabsContent>
    </Tabs>
  );
}

/** Studio right-panel "Media Library": your edited Excerpts (from the Video
 * Editor) plus free stock media (overlay / cloud video-library / download). */
export function StockMediaPanel() {
  const { updateLogo, uploadVideoFile, addControlRoomSound, mediaLibrarySection, setMediaLibrarySection } = useStudio();
  const { toast } = useToast();

  // Sound Fx: download the picked Freesound effect and add it to the Control
  // Room as a cue button under its Sound Fx tab, prefixed "FX ·" so effects
  // read clearly.
  const loadSoundFx = useCallback(async (sound: FreesoundSound) => {
    const file = await downloadSound(sound);
    const label = sound.name.replace(/\.(wav|aiff?|ogg|mp3|m4a|flac|aac)$/i, '');
    const added = await addControlRoomSound({ file, name: `FX · ${label}`.slice(0, 80) });
    toast(added
      ? { title: 'Added to Control Room', description: 'Fire it from Control Room → Sound Fx.' }
      : { title: 'Control Room Sound Fx is full', description: 'Remove a cue to add another.', variant: 'destructive' });
  }, [addControlRoomSound, toast]);

  const actions: StockActions = useMemo(() => {
    const download: StockItemAction = {
      key: 'download', icon: Download, title: 'Download', run: (file) => downloadFile(file),
    };
    return {
      photo: [
        {
          key: 'overlay', icon: ImagePlus, label: 'Overlay', fullWidth: true,
          title: 'Set as the broadcast logo/watermark overlay',
          run: (file) => {
            // A blob File keeps the broadcast canvas untainted (a hotlinked
            // cross-origin image would poison capture).
            updateLogo({
              url: URL.createObjectURL(file),
              kind: 'image', x: 0.9, y: 0.1, scale: 0.12, opacity: 100, visible: true,
            });
            toast({ title: 'Overlay set', description: 'Adjust it under Graphic Interface → Logo.' });
          },
        },
        download,
      ],
      audio: [{ ...download, label: 'Download', title: "Download (use in the Editor's music track)" }],
      video: [
        {
          key: 'library', icon: CloudUpload, label: 'Add to Library', fullWidth: true,
          title: 'Upload to your cloud Video Library (usable as a broadcast source)',
          run: async (file, item) => {
            const ok = await uploadVideoFile(file, item.title);
            if (ok) toast({ title: 'Added to library', description: 'Available in your Video Library for playback.' });
          },
        },
        download,
      ],
    };
  }, [updateLogo, uploadVideoFile, toast]);

  return (
    <Tabs value={mediaLibrarySection} onValueChange={setMediaLibrarySection} className="w-full">
      <TabsList className="grid w-full grid-cols-3 h-8 mb-4">
        <TabsTrigger value="excerpts" className="text-xs gap-1 px-1"><Clapperboard className="h-3 w-3 shrink-0" />Excerpts</TabsTrigger>
        <TabsTrigger value="stock" className="text-xs gap-1 px-1"><Images className="h-3 w-3 shrink-0" />Stock</TabsTrigger>
        <TabsTrigger value="soundfx" className="text-xs gap-1 px-1"><Volume2 className="h-3 w-3 shrink-0" />Sound Fx</TabsTrigger>
      </TabsList>
      <TabsContent value="excerpts" className="mt-0"><ExcerptsLibrary /></TabsContent>
      <TabsContent value="stock" className="mt-0"><StockMediaBrowser actions={actions} /></TabsContent>
      <TabsContent value="soundfx" className="mt-0"><SoundFxPanel onAdd={loadSoundFx} destinationLabel="Control Room" addLabel="Add to Control Room" /></TabsContent>
    </Tabs>
  );
}
