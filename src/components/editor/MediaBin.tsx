import { useCallback, useEffect, useRef, useState } from 'react';
import type { Recording } from '@/hooks/useRecordings';
import type { StockMediaItem } from '@/lib/editorStock';
import { Cloud, HardDrive, Plus, Loader2, Film, Image as ImageIcon, Music, Sparkles, Trash2, Pencil, Check, Play, Pause } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

function formatDuration(sec: number | null): string {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const STOCK_ICON = { photo: ImageIcon, audio: Music, video: Film } as const;

/** Inline-editable media title: click the pencil (or double-click the name) to
 * rename; Enter/blur commits, Esc cancels. */
function EditableTitle({ value, onCommit, prefix }: {
  value: string;
  onCommit: (name: string) => void;
  prefix?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== value) onCommit(t);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { setDraft(value); setEditing(false); }
          }}
          onClick={e => e.stopPropagation()}
          className="min-w-0 flex-1 bg-background border border-primary/50 rounded px-1 py-0.5 text-xs text-foreground outline-none"
        />
        <button onMouseDown={e => e.preventDefault()} onClick={commit} className="p-0.5 text-primary shrink-0" title="Save name">
          <Check className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <p className="text-xs font-medium text-foreground truncate flex items-center gap-1" title={value}>
      {prefix}
      <span className="truncate">{value}</span>
      <button
        onClick={() => setEditing(true)}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-primary transition-opacity shrink-0"
        title="Rename"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </p>
  );
}

/** Single-instance audio preview for the Media bin: only one clip plays at a
 * time, and clicking a playing clip pauses it. Resolves the blob lazily (audio
 * lives in IndexedDB) and reports a per-item loading state so the button can
 * show a spinner while the URL is fetched. */
function useAudioPreview(resolveUrl: (item: StockMediaItem) => Promise<string | null>) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Stop and release the shared element when the panel unmounts.
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setPlayingId(null);
  }, []);

  const toggle = useCallback(async (item: StockMediaItem) => {
    // Clicking the clip that's already playing pauses it.
    if (playingId === item.id) { stop(); return; }
    audioRef.current?.pause();
    setLoadingId(item.id);
    let url: string | null = null;
    try { url = await resolveUrl(item); } finally { setLoadingId(null); }
    if (!url) return;
    const audio = audioRef.current ?? (audioRef.current = new Audio());
    audio.src = url;
    audio.onended = () => setPlayingId(cur => (cur === item.id ? null : cur));
    try { await audio.play(); setPlayingId(item.id); }
    catch { setPlayingId(null); }
  }, [playingId, resolveUrl, stop]);

  return { playingId, loadingId, toggle, stop };
}

type MediaCategory = 'video' | 'photo' | 'audio';

const CATEGORIES: { key: MediaCategory; label: string; icon: typeof Film }[] = [
  { key: 'video', label: 'Video', icon: Film },
  { key: 'photo', label: 'Photo', icon: ImageIcon },
  { key: 'audio', label: 'Music & Sound FX', icon: Music },
];

/** Left panel: the user's saved StreamForge recordings plus any free stock
 * media pulled in from the Stock browser — organized by media type into
 * icon tabs (Video · Photo · Music & Sound FX). Click + to add to the timeline. */
export function MediaBin({
  recordings, loading, onAdd, stockItems, onAddStock, onDeleteRecording, onDeleteStock,
  onRenameRecording, onRenameStock, resolveAudioUrl,
}: {
  recordings: Recording[];
  loading: boolean;
  onAdd: (rec: Recording) => Promise<void>;
  stockItems: StockMediaItem[];
  onAddStock: (item: StockMediaItem) => void;
  onDeleteRecording: (rec: Recording) => Promise<void>;
  onDeleteStock: (item: StockMediaItem) => void | Promise<void>;
  onRenameRecording: (id: string, name: string) => void;
  onRenameStock: (item: StockMediaItem, name: string) => void;
  /** Resolve an audio bin item to a playable object URL, for the preview button. */
  resolveAudioUrl: (item: StockMediaItem) => Promise<string | null>;
}) {
  const [addingId, setAddingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState<MediaCategory | null>(null);
  const { playingId, loadingId: previewLoadingId, toggle: togglePreview, stop: stopPreview } = useAudioPreview(resolveAudioUrl);

  const ready = recordings.filter(r => r.status === 'ready' || r.storage_type === 'local');
  const videoStock = stockItems.filter(i => i.kind === 'video');
  const photoStock = stockItems.filter(i => i.kind === 'photo');
  const audioStock = stockItems.filter(i => i.kind === 'audio');

  // If the clip being previewed is removed from the bin, stop playback.
  useEffect(() => {
    if (playingId && !audioStock.some(i => i.id === playingId)) stopPreview();
  }, [playingId, audioStock, stopPreview]);

  const counts: Record<MediaCategory, number> = {
    video: ready.length + videoStock.length,
    photo: photoStock.length,
    audio: audioStock.length,
  };

  const handleAdd = async (rec: Recording) => {
    setAddingId(rec.id);
    try { await onAdd(rec); } finally { setAddingId(null); }
  };

  const recordingRow = (rec: Recording) => (
    <div
      key={rec.id}
      className="group flex items-center gap-2 rounded-md border border-border/60 bg-secondary/30 hover:bg-secondary/60 px-2 py-1.5 transition-colors"
    >
      <div className="h-9 w-12 rounded bg-black/60 flex items-center justify-center shrink-0">
        <Film className="h-4 w-4 text-muted-foreground/60" />
      </div>
      <div className="min-w-0 flex-1">
        <EditableTitle value={rec.title} onCommit={name => onRenameRecording(rec.id, name)} />
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          {rec.storage_type === 'cloud' ? <Cloud className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}
          {formatDuration(rec.duration_seconds)}
        </p>
      </div>
      <div className="flex items-center shrink-0">
        <button
          onClick={() => handleAdd(rec)}
          disabled={addingId === rec.id}
          className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          title="Add to timeline"
        >
          {addingId === rec.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title={`Delete ${rec.title}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
              <AlertDialogDescription>
                "{rec.title}" will also be permanently deleted from your Studio
                Archive library, and removed from this timeline. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onDeleteRecording(rec)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete everywhere
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );

  const stockRow = (item: StockMediaItem) => {
    const Icon = STOCK_ICON[item.kind];
    const isAudio = item.kind === 'audio';
    const isPreviewing = playingId === item.id;
    const isPreviewLoading = previewLoadingId === item.id;
    return (
      <div
        key={item.id}
        className="group flex items-center gap-2 rounded-md border border-accent/40 bg-accent/5 hover:bg-accent/10 px-2 py-1.5 transition-colors"
      >
        <div className="h-9 w-12 rounded bg-black/60 flex items-center justify-center shrink-0 overflow-hidden">
          {isAudio ? (
            <button
              onClick={() => togglePreview(item)}
              disabled={isPreviewLoading}
              className="h-full w-full flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/15 transition-colors"
              title={isPreviewing ? `Pause preview of ${item.name}` : `Play preview of ${item.name}`}
              aria-label={isPreviewing ? `Pause preview of ${item.name}` : `Play preview of ${item.name}`}
            >
              {isPreviewLoading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : isPreviewing
                  ? <Pause className="h-4 w-4" />
                  : <Play className="h-4 w-4 ml-0.5" />}
            </button>
          ) : item.thumbnail
            ? <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
            : <Icon className="h-4 w-4 text-muted-foreground/60" />}
        </div>
        <div className="min-w-0 flex-1">
          <EditableTitle
            value={item.name}
            onCommit={name => onRenameStock(item, name)}
            prefix={<Sparkles className="h-3 w-3 text-accent shrink-0" />}
          />
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Icon className="h-3 w-3" />
            {item.kind}{formatDuration(item.duration) && ` · ${formatDuration(item.duration)}`}
          </p>
        </div>
        <div className="flex items-center shrink-0">
          <button
            onClick={() => onAddStock(item)}
            className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Add to timeline"
          >
            <Plus className="h-4 w-4" />
          </button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Remove from Media bin"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this media?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes “{item.name}” ({item.kind}) from your editor and
                  takes it off this timeline. It's an imported clip and isn't part
                  of your Studio Archive, so nothing there is affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDeleteStock(item)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    );
  };

  // Empty a whole category by running the existing per-item handlers in
  // sequence, so timeline references, cloud rows, and asset blobs all get the
  // same cleanup as a single delete.
  const deleteAllInCategory = async (cat: MediaCategory) => {
    setDeletingAll(cat);
    try {
      if (cat === 'video') {
        for (const rec of ready) await onDeleteRecording(rec);
        for (const item of videoStock) await onDeleteStock(item);
      } else if (cat === 'photo') {
        for (const item of photoStock) await onDeleteStock(item);
      } else {
        stopPreview();
        for (const item of audioStock) await onDeleteStock(item);
      }
    } finally {
      setDeletingAll(null);
    }
  };

  const deleteAllRow = (cat: MediaCategory, title: string, description: string, actionLabel: string) => (
    <div className="flex justify-end pb-0.5">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            disabled={deletingAll !== null}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive px-1.5 py-0.5 rounded hover:bg-destructive/10 transition-colors disabled:opacity-50"
            title={title}
          >
            {deletingAll === cat ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Delete all ({counts[cat]})
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void deleteAllInCategory(cat)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  const emptyState = (Icon: typeof Film, text: string) => (
    <div className="text-center py-8 px-2">
      <Icon className="h-7 w-7 text-muted-foreground/30 mx-auto mb-2" />
      <p className="text-xs text-muted-foreground">{text}</p>
      <p className="text-[11px] text-muted-foreground/60 mt-1">
        Record in the studio, or add media from the timeline toolbar.
      </p>
    </div>
  );

  return (
    <div className="w-64 border-r border-border bg-card/40 flex flex-col shrink-0">
      <div className="px-3 py-2.5 border-b border-border">
        <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Media</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">Organized by type — recordings &amp; stock</p>
      </div>

      <Tabs defaultValue="video" className="flex-1 flex flex-col min-h-0">
        <TabsList className="grid grid-cols-3 h-9 mx-2 mt-2 shrink-0">
          {CATEGORIES.map(({ key, label, icon: Icon }) => (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <TabsTrigger value={key} className="relative" aria-label={label}>
                  <Icon className="h-4 w-4" />
                  {counts[key] > 0 && (
                    <span className="ml-1 text-[10px] font-mono tabular-nums text-muted-foreground">
                      {counts[key]}
                    </span>
                  )}
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">{label}</TooltipContent>
            </Tooltip>
          ))}
        </TabsList>

        <TabsContent value="video" className="flex-1 overflow-y-auto p-2 space-y-1.5 mt-0 min-h-0">
          {loading && ready.length === 0 && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {!loading && counts.video === 0 && emptyState(Film, 'No video yet')}
          {!loading && counts.video > 0 && deleteAllRow(
            'video',
            'Delete all videos?',
            `This deletes all ${counts.video} video item(s) and takes their clips off this timeline. `
              + `Your recordings are also permanently deleted from the Studio Archive library — this can't be undone. `
              + `Imported stock clips are only removed from the editor.`,
            'Delete all videos',
          )}
          {ready.map(recordingRow)}
          {videoStock.map(stockRow)}
        </TabsContent>

        <TabsContent value="photo" className="flex-1 overflow-y-auto p-2 space-y-1.5 mt-0 min-h-0">
          {counts.photo === 0 && emptyState(ImageIcon, 'No photos yet')}
          {counts.photo > 0 && deleteAllRow(
            'photo',
            'Remove all photos?',
            `This removes all ${counts.photo} photo(s) from your editor and takes their overlays off this timeline. `
              + `They're imported media, so your Studio Archive isn't affected.`,
            'Remove all photos',
          )}
          {photoStock.map(stockRow)}
        </TabsContent>

        <TabsContent value="audio" className="flex-1 overflow-y-auto p-2 space-y-1.5 mt-0 min-h-0">
          {counts.audio === 0 && emptyState(Music, 'No music or sound FX yet')}
          {counts.audio > 0 && deleteAllRow(
            'audio',
            'Remove all music & sound FX?',
            `This removes all ${counts.audio} audio item(s) from your editor and takes their clips off this timeline. `
              + `They're imported media, so your Studio Archive isn't affected.`,
            'Remove all audio',
          )}
          {audioStock.map(stockRow)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
