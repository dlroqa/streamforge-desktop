import { useCallback, useEffect, useState } from 'react';
import { useStudio } from '@/contexts/StudioContext';
import {
  listExcerpts, deleteExcerpt, renameExcerpt, getExcerptFile, onExcerptsChanged, type ExcerptMeta,
} from '@/lib/excerpts';
import { downloadFile } from '@/lib/stockMedia';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { Clapperboard, Radio, Video, Download, Trash2, Loader2, Play, Pause, Headphones, X, PictureInPicture2, Pencil, Check } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

function fmtDuration(s: number): string {
  if (!s || !Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}
function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Inline-editable excerpt title: pencil to edit; Enter/blur saves, Esc cancels. */
function ExcerptTitle({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(() => { if (!editing) setDraft(name); }, [name, editing]);

  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== name) onRename(t);
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
            else if (e.key === 'Escape') { setDraft(name); setEditing(false); }
          }}
          className="min-w-0 flex-1 bg-background border border-primary/50 rounded px-1 py-0.5 text-xs text-foreground outline-none"
        />
        <button onMouseDown={e => e.preventDefault()} onClick={commit} className="p-0.5 text-primary shrink-0" title="Save name">
          <Check className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <p className="text-xs font-medium text-foreground truncate flex items-center gap-1" title={name}>
      <span className="truncate">{name}</span>
      <button
        onClick={() => setEditing(true)}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-primary transition-opacity shrink-0"
        title="Rename excerpt"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </p>
  );
}

/** Media Library → Excerpts: edited videos exported from the Video Editor.
 * Cue one as the active broadcast video source, revert to the camera, or
 * download / remove it. */
export function ExcerptsLibrary() {
  const {
    startExcerptPlayback, stopMediaPlayback, mediaPlayback,
    mediaPaused, mediaMonitor, toggleMediaPlayback, toggleMediaMonitor,
    mediaOnAir, mediaTime, mediaDuration, holdCueToCamera, resumeCue, seekMedia,
    mediaHideCamera, toggleMediaCameraPip,
  } = useStudio();
  const { toast } = useToast();
  const [items, setItems] = useState<ExcerptMeta[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => { void listExcerpts().then(setItems); }, []);
  // Reload on mount and whenever the editor saves/removes an excerpt.
  useEffect(() => { load(); return onExcerptsChanged(load); }, [load]);

  const isCued = (m: ExcerptMeta) => mediaPlayback?.recordingId === `excerpt-${m.id}`;

  const cue = async (m: ExcerptMeta) => {
    setBusyId(m.id);
    try {
      const ok = await startExcerptPlayback(m);
      if (ok) toast({ title: 'Cued as video source', description: `“${m.name}” is now the active source.` });
      else toast({ title: 'Could not cue excerpt', description: 'Its data may have been cleared.', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const download = async (m: ExcerptMeta) => {
    const file = await getExcerptFile(m);
    if (file) downloadFile(file);
  };

  const remove = async (m: ExcerptMeta) => {
    if (isCued(m)) stopMediaPlayback();
    await deleteExcerpt(m.id);
    load();
  };

  const rename = async (id: string, name: string) => {
    await renameExcerpt(id, name);
    load();
  };

  if (items === null) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-10 px-3">
        <Clapperboard className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No excerpts yet</p>
        <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">
          In the Video Editor, click <span className="font-medium text-foreground">Export → Save to Media Library</span> to
          keep an edited video here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Cue transport — progress, pause, hold-to-camera / back-to-cue, monitor. */}
      {mediaPlayback && (
        <div className={`rounded-lg border px-2.5 py-2 space-y-2 ${mediaOnAir ? 'border-primary/40 bg-primary/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
          <div className="flex items-center gap-1.5 text-[11px] min-w-0">
            {mediaOnAir
              ? <Radio className="h-3.5 w-3.5 text-primary shrink-0 animate-pulse-live" />
              : <Pause className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
            <span className="truncate text-foreground">
              <span className="font-medium">{mediaOnAir ? 'On air' : 'Held'}:</span> {mediaPlayback.title}
            </span>
          </div>

          {/* Progress / scrubber */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-9 text-right">{fmtDuration(mediaTime) || '0:00'}</span>
            <Slider
              value={[Math.min(mediaTime, mediaDuration || mediaTime)]}
              max={mediaDuration || 0.001}
              step={0.1}
              onValueChange={([v]) => seekMedia(v)}
              className="flex-1"
            />
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-9">{fmtDuration(mediaDuration) || '0:00'}</span>
          </div>

          <div className="flex items-center gap-1.5">
            {mediaOnAir ? (
              <>
                <Button size="sm" variant="secondary" onClick={toggleMediaPlayback} className="h-7 flex-1 gap-1.5 text-[11px]" title={mediaPaused ? 'Resume playback' : 'Pause the video on air'}>
                  {mediaPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                  {mediaPaused ? 'Resume' : 'Pause'}
                </Button>
                <Button
                  size="sm"
                  variant={mediaHideCamera ? 'default' : 'ghost'}
                  onClick={toggleMediaCameraPip}
                  className="h-7 px-2"
                  title={mediaHideCamera ? 'Clean excerpt — camera PiP hidden (click to show it)' : 'Camera showing as PiP (click to hide for a clean excerpt)'}
                >
                  <PictureInPicture2 className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="outline" onClick={holdCueToCamera} className="h-7 gap-1.5 text-[11px]" title="Cut to camera and hold the video here — resume later without restarting">
                  <Video className="h-3 w-3" /> Camera
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={resumeCue} className="h-7 flex-1 gap-1.5 text-[11px]" title="Return to the video and continue from where it paused">
                <Radio className="h-3 w-3" /> Back to cue
              </Button>
            )}
            <Button
              size="sm"
              variant={mediaMonitor ? 'default' : 'ghost'}
              onClick={toggleMediaMonitor}
              className="h-7 px-2"
              title={mediaMonitor ? 'Monitoring audio (you hear it)' : 'Monitor audio off'}
            >
              <Headphones className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" onClick={stopMediaPlayback} className="h-7 px-2 text-muted-foreground hover:text-destructive" title="Clear the cue">
              <X className="h-3 w-3" />
            </Button>
          </div>
          {mediaMonitor && (
            <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
              Use headphones — monitoring through speakers can echo into your mic.
            </p>
          )}
        </div>
      )}

      {items.map(m => (
        <div key={m.id} className="group rounded-lg border border-border bg-secondary/30 p-2.5 space-y-2">
          <div className="flex items-start gap-2">
            <div className="h-10 w-14 rounded bg-black/60 flex items-center justify-center shrink-0">
              <Clapperboard className="h-4 w-4 text-muted-foreground/60" />
            </div>
            <div className="min-w-0 flex-1">
              <ExcerptTitle name={m.name} onRename={n => rename(m.id, n)} />
              <p className="text-[10px] text-muted-foreground">
                {[fmtDuration(m.duration), `${m.width}×${m.height}`, fmtSize(m.size)].filter(Boolean).join(' · ')}
              </p>
              <p className="text-[10px] text-muted-foreground/70">{new Date(m.createdAt).toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {!isCued(m) ? (
              <Button
                size="sm"
                onClick={() => cue(m)}
                disabled={busyId === m.id}
                className="h-7 flex-1 gap-1.5 text-[11px]"
                title="Cue as the active broadcast video source"
              >
                {busyId === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Radio className="h-3 w-3" />}
                Cue as source
              </Button>
            ) : mediaOnAir ? (
              <span className="h-7 flex-1 flex items-center justify-center gap-1.5 rounded-md border border-primary/50 text-[11px] font-medium text-primary">
                <Radio className="h-3 w-3 animate-pulse-live" /> On air — controls above
              </span>
            ) : (
              <Button
                size="sm"
                onClick={resumeCue}
                className="h-7 flex-1 gap-1.5 text-[11px]"
                title="Continue this video from where it paused"
              >
                <Play className="h-3 w-3" /> Back to cue
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => download(m)} className="h-7 px-2 text-[11px]" title="Download">
              <Download className="h-3 w-3" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" title="Remove excerpt">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this excerpt?</AlertDialogTitle>
                  <AlertDialogDescription>
                    “{m.name}” will be deleted from your Media Library. If you already added it to your
                    Video Library, that copy stays. This can't be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => remove(m)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ))}
    </div>
  );
}
