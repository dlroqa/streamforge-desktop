import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecordings, type Recording } from '@/hooks/useRecordings';
import { useEditorProject } from '@/hooks/useEditorProject';
import { useMediaResolver, probeDuration } from '@/lib/editorMedia';
import { putAsset, getAssetUrl, deleteAsset, getMeta, putMeta } from '@/lib/editorAssets';
import { projectDuration, formatTimecode, clipAtTime, audioClipsAtTime, overlaysAtTime, updateOverlayById, STABILIZE_VERSION } from '@/lib/editorProject';
import { upsertKeyframe } from '@/lib/overlayAnimation';
import { PreviewCanvas } from './PreviewCanvas';
import { Timeline } from './Timeline';
import { MediaBin } from './MediaBin';
import { PropertiesPanel } from './PropertiesPanel';
import { exportProjectWebm } from '@/lib/videoExport';
import { StockMediaBrowser, type StockActions } from '@/components/studio/StockMediaPanel';
import { MotionGraphicsBrowser, type MotionAction } from '@/components/studio/MotionGraphicsPanel';
import { VideoCutDialog } from './VideoCutDialog';
import { AddMusicDialog } from './AddMusicDialog';
import type { StockItem } from '@/lib/stockMedia';
import { resolveVideoCut, type VideoContainer } from '@/lib/videoCut';
import { fetchSunoFile, type SunoTrack } from '@/lib/suno';
import { downloadSound, type FreesoundSound } from '@/lib/freesound';
import { SoundFxPanel } from './SoundFxPanel';
import { saveExcerpt } from '@/lib/excerpts';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type StockMediaItem, blobToDataUrl } from '@/lib/editorStock';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { Radio, Play, Pause, SkipBack, Download, Loader2, Plus, ChevronDown, Library } from 'lucide-react';

const ASPECTS = [
  { key: '16:9', label: 'Landscape 16:9', w: 1920, h: 1080 },
  { key: '9:16', label: 'Portrait 9:16', w: 1080, h: 1920 },
  { key: '1:1', label: 'Square 1:1', w: 1080, h: 1080 },
];

export function EditorApp() {
  const { recordings, loading, getCloudUrl, deleteRecording, renameRecording } = useRecordings();
  const {
    project, removeClip, updateClip, rename, addRecording, splitAt, splitAudioAt, splitOverlayAt, splitAllAtTime, setCanvasSize,
    addTextOverlay, addLowerThirdOverlay, addImageOverlay, removeOverlay,
    addAudioClip, removeAudioClip,
    setProjectTransient, commitHistory, undo, redo, canUndo, canRedo,
  } = useEditorProject();
  const resolve = useMediaResolver(recordings, getCloudUrl);
  const resolveAudio = useCallback((assetId: string) => getAssetUrl(assetId), []);
  const { toast } = useToast();

  // Free stock media the user has pulled into the Media bin.
  const [stockItems, setStockItems] = useState<StockMediaItem[]>([]);
  // Persist the imported-media bin (with any custom names) across sessions.
  // Metadata lives in IndexedDB 'meta'; the audio/video blobs already persist
  // via their assetId. Gate saving until the initial load runs so a first
  // mount can't overwrite the saved list with an empty one.
  const binHydrated = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await getMeta<StockMediaItem[]>('stock-bin');
      if (!cancelled && Array.isArray(saved) && saved.length) {
        // Drop items whose backing blob was evicted; keep inline-photo items.
        const valid: StockMediaItem[] = [];
        for (const it of saved) {
          if (it.assetId) { if (await getAssetUrl(it.assetId)) valid.push(it); }
          else if (it.dataUrl) valid.push(it);
        }
        if (!cancelled) setStockItems(prev => (prev.length ? prev : valid));
      }
      binHydrated.current = true;
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!binHydrated.current) return;
    void putMeta('stock-bin', stockItems);
  }, [stockItems]);

  const onRenameStock = useCallback((item: StockMediaItem, name: string) => {
    const clean = name.trim().slice(0, 80);
    if (!clean) return;
    setStockItems(prev => prev.map(s => (s.id === item.id ? { ...s, name: clean } : s)));
  }, []);
  const [stockOpen, setStockOpen] = useState(false);
  const [motionOpen, setMotionOpen] = useState(false);
  const [videoCutOpen, setVideoCutOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [soundFxOpen, setSoundFxOpen] = useState(false);

  // Resolve a video clip's recordingId — stock assets first (IndexedDB blob),
  // otherwise fall through to the recordings resolver. Depends on stockItems so
  // that after the bin hydrates on refresh, the preview retries and resolves
  // stock/Video Cut clips instead of staying black.
  const resolveClip = useCallback(async (recordingId: string): Promise<string | null> => {
    // A stabilized clip resolves to its baked copy in the editor-assets store.
    if (recordingId.startsWith('stab:')) return getAssetUrl(recordingId.slice(5));
    const s = stockItems.find(x => x.id === recordingId);
    if (s?.assetId) return getAssetUrl(s.assetId);
    return resolve(recordingId);
  }, [resolve, stockItems]);

  // Stabilization bake state (one clip at a time; FFmpeg is single-threaded).
  const [stabilizingClipId, setStabilizingClipId] = useState<string | null>(null);
  const [stabilizePct, setStabilizePct] = useState(0);

  // Toggle/apply FFmpeg deshake for a clip. Enabling with no baked copy (or a
  // changed strength) runs the deshake pass, stores the result as an editor
  // asset, and points the clip at it via `stabilizedAssetId`; disabling keeps
  // the baked copy so re-enabling is instant.
  const onStabilize = useCallback(async (clipId: string, enabled: boolean, strength: number) => {
    const clip = project.clips.find(c => c.id === clipId);
    if (!clip) return;
    if (!enabled) { updateClip(clipId, { stabilize: false }); return; }
    const needsBake = !clip.stabilizedAssetId
      || (clip.stabilizeStrength ?? 0.5) !== strength
      || clip.stabilizeVersion !== STABILIZE_VERSION;
    if (!needsBake) { updateClip(clipId, { stabilize: true, stabilizeStrength: strength }); return; }
    if (stabilizingClipId) return; // one bake at a time

    setStabilizingClipId(clipId);
    setStabilizePct(0);
    try {
      const url = await resolveClip(clip.recordingId);
      if (!url) throw new Error('Could not load the clip source to stabilize.');
      const res = await fetch(url);
      if (!res.ok) throw new Error('Could not download the clip source (network/CORS).');
      const { stabilizeVideo } = await import('@/lib/stabilize');
      const out = await stabilizeVideo(await res.blob(), { strength, onProgress: setStabilizePct });
      const previousAsset = clip.stabilizedAssetId;
      const assetId = await putAsset(out);
      updateClip(clipId, { stabilize: true, stabilizeStrength: strength, stabilizedAssetId: assetId, stabilizeVersion: STABILIZE_VERSION });
      if (previousAsset) deleteAsset(previousAsset).catch(() => {});
      toast({ title: 'Stabilized', description: 'This clip now plays its stabilized copy.' });
    } catch (e) {
      updateClip(clipId, { stabilize: false });
      toast({
        variant: 'destructive',
        title: 'Stabilization failed',
        description: e instanceof Error ? e.message : 'Could not stabilize this clip.',
      });
    } finally {
      setStabilizingClipId(null);
      setStabilizePct(0);
    }
  }, [project.clips, updateClip, resolveClip, stabilizingClipId, toast]);

  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);
  // Name-before-save dialog for the "Save to Excerpts" export.
  const [excerptDialogOpen, setExcerptDialogOpen] = useState(false);
  const [excerptName, setExcerptName] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const overlayBefore = useRef<Parameters<typeof commitHistory>[0] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const duration = projectDuration(project);
  const selectedClip = project.clips.find(c => c.id === selectedClipId) ?? null;
  const selectedOverlay = project.overlays.find(o => o.id === selectedOverlayId) ?? null;
  const selectedAudio = project.audioClips.find(a => a.id === selectedAudioId) ?? null;
  const aspectKey = ASPECTS.find(a => Math.abs(a.w / a.h - project.width / project.height) < 0.01)?.key ?? '16:9';

  const handleAdd = useCallback(async (rec: Recording) => {
    const url = await resolve(rec.id);
    if (!url) {
      toast({ title: 'Could not open recording', description: 'The file may be offline or the link expired.', variant: 'destructive' });
      return;
    }
    const dur = rec.duration_seconds || await probeDuration(url);
    const id = addRecording({ recordingId: rec.id, name: rec.title, sourceDuration: dur });
    setSelectedClipId(id); setSelectedAudioId(null); setSelectedOverlayId(null);
  }, [resolve, addRecording, toast]);

  const seek = useCallback((t: number) => {
    setPlaying(false);
    setPlayhead(Math.max(0, Math.min(t, duration || t)));
  }, [duration]);

  const togglePlay = useCallback(() => {
    if (!duration) return;
    setPlaying(p => {
      if (!p && playhead >= duration - 0.05) setPlayhead(0);
      return !p;
    });
  }, [duration, playhead]);

  const onEnded = useCallback(() => { setPlaying(false); setPlayhead(duration); }, [duration]);

  // Export the timeline, then either download the file or save it into the
  // Studio's Media Library as an "Excerpt" (shared IndexedDB, so it shows up
  // in the studio window's Media Library → Excerpts).
  const onExport = useCallback(async (dest: 'download' | 'excerpt', nameOverride?: string) => {
    if (!duration || exporting) return;
    setPlaying(false);
    setExporting(true);
    setExportPct(0);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const blob = await exportProjectWebm(project, resolveClip, resolveAudio, { onProgress: setExportPct, signal: abort.signal });
      const name = (nameOverride?.trim() || project.name || 'export');
      if (dest === 'excerpt') {
        const saved = await saveExcerpt(blob, { name, duration, width: project.width, height: project.height });
        if (saved) {
          toast({ title: 'Saved to Media Library', description: `“${name}” is in Studio → Media Library → Excerpts.` });
        } else {
          toast({ title: 'Could not save excerpt', description: 'Check you are signed in and try again.', variant: 'destructive' });
        }
      } else {
        const safe = name.replace(/[^a-z0-9]+/gi, '_');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safe}.webm`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast({ title: 'Export complete', description: `${safe}.webm downloaded.` });
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== 'Export cancelled') toast({ title: 'Export failed', description: msg, variant: 'destructive' });
    } finally {
      setExporting(false);
      abortRef.current = null;
    }
  }, [duration, exporting, project, resolveClip, resolveAudio, toast]);

  // Cut at the playhead. If a specific clip/audio/overlay is selected, split
  // just that one; otherwise razor every track crossing the playhead so any
  // media type gets cut.
  const onSplit = useCallback(() => {
    if (selectedAudioId && audioClipsAtTime(project, playhead).some(a => a.id === selectedAudioId)) {
      splitAudioAt(selectedAudioId, playhead);
    } else if (selectedOverlayId && overlaysAtTime(project, playhead).some(o => o.id === selectedOverlayId)) {
      splitOverlayAt(selectedOverlayId, playhead);
    } else if (selectedClipId && (clipAtTime(project, playhead)?.id === selectedClipId)) {
      splitAt(selectedClipId, playhead);
    } else {
      splitAllAtTime(playhead);
    }
  }, [project, playhead, selectedAudioId, selectedOverlayId, selectedClipId,
      splitAt, splitAudioAt, splitOverlayAt, splitAllAtTime]);

  const onAddText = useCallback(() => {
    const id = addTextOverlay(playhead);
    setSelectedOverlayId(id);
    setSelectedClipId(null);
  }, [addTextOverlay, playhead]);

  const onAddLowerThird = useCallback(() => {
    const id = addLowerThirdOverlay(playhead);
    setSelectedOverlayId(id);
    setSelectedClipId(null);
  }, [addLowerThirdOverlay, playhead]);

  const onImageFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      const reader = new FileReader();
      reader.onload = () => {
        const id = addImageOverlay(playhead, String(reader.result));
        setSelectedOverlayId(id);
        setSelectedClipId(null);
      };
      reader.readAsDataURL(f);
    }
    e.target.value = '';
  }, [addImageOverlay, playhead]);

  const onAudioFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const assetId = await putAsset(f);
      const url = await getAssetUrl(assetId);
      const dur = url ? await probeDuration(url) : 0;
      const id = addAudioClip(assetId, f.name.replace(/\.[^/.]+$/, ''), dur, playhead);
      setSelectedAudioId(id);
      setSelectedClipId(null);
      setSelectedOverlayId(null);
    } catch {
      toast({ title: 'Could not add audio', description: 'That file could not be loaded.', variant: 'destructive' });
    }
  }, [addAudioClip, playhead, toast]);

  // "Download" a stock item into the Media bin (left panel) as "Stock".
  // Photos keep an inline data URL (persist as overlay src); audio/video blobs
  // go to IndexedDB and are referenced by assetId.
  const addStockToBin = useCallback(async (file: File, item: StockItem) => {
    if (item.kind === 'photo') {
      const dataUrl = await blobToDataUrl(file);
      setStockItems(prev => [{
        id: crypto.randomUUID(), kind: 'photo', name: 'Stock', title: item.title,
        duration: 0, thumbnail: dataUrl, dataUrl, width: item.width, height: item.height,
      }, ...prev]);
    } else {
      const assetId = await putAsset(file);
      const url = await getAssetUrl(assetId);
      const duration = url ? await probeDuration(url) : 0;
      setStockItems(prev => [{
        id: `stock-${assetId}`, kind: item.kind, name: 'Stock', title: item.title,
        duration, thumbnail: item.thumbnail, assetId, width: item.width, height: item.height,
      }, ...prev]);
    }
    toast({ title: 'Added to Media', description: 'Find it in the Media panel on the left as “Stock”.' });
  }, [toast]);

  // Motion Graphics: store the generated video like a stock clip and drop it
  // in the Media bin as "Motion" — trimmable and exportable like any clip.
  const motionActions: MotionAction[] = useMemo(() => [{
    key: 'add', icon: Plus, label: 'Add to Media',
    title: 'Download into your Media bin',
    run: async (file, meta) => {
      const assetId = await putAsset(file);
      const assetUrl = await getAssetUrl(assetId);
      const dur = assetUrl ? await probeDuration(assetUrl) : meta.duration;
      setStockItems(prev => [{
        id: `stock-${assetId}`, kind: 'video', name: 'Motion',
        title: meta.prompt.slice(0, 80) || 'Motion graphic', duration: dur, assetId,
        width: meta.width, height: meta.height,
      }, ...prev]);
      toast({ title: 'Motion graphic added', description: 'Find it in the Media panel on the left as “Motion”.' });
    },
  }], [toast]);

  // Video Cut: resolve a URL to a video File, store it like a stock video, and
  // drop it in the Media bin as "Video Cut" — fully trimmable and exportable.
  const loadVideoCut = useCallback(async (url: string, format: VideoContainer) => {
    const file = await resolveVideoCut(url, { format });
    const assetId = await putAsset(file);
    const assetUrl = await getAssetUrl(assetId);
    const dur = assetUrl ? await probeDuration(assetUrl) : 0;
    setStockItems(prev => [{
      id: `stock-${assetId}`, kind: 'video', name: 'Video Cut',
      title: file.name.replace(/\.[^/.]+$/, ''), duration: dur, assetId,
    }, ...prev]);
    toast({ title: 'Video loaded', description: 'Added to your Media bin as “Video Cut”.' });
  }, [toast]);

  // Suno: fetch each resolved track's MP3 and drop it in the Media bin as an
  // audio item (like Video Cut / stock). The user then adds it to the audio
  // track from the bin — same flow as every other piece of media.
  const loadSuno = useCallback(async (tracks: SunoTrack[]) => {
    for (const track of tracks) {
      const file = await fetchSunoFile(track);
      const assetId = await putAsset(file);
      const assetUrl = await getAssetUrl(assetId);
      const dur = assetUrl ? await probeDuration(assetUrl) : 0;
      const title = track.title || file.name.replace(/\.[^/.]+$/, '');
      setStockItems(prev => [{
        id: `stock-${assetId}`, kind: 'audio', name: title, title, duration: dur, assetId,
      }, ...prev]);
    }
    toast({
      title: tracks.length > 1 ? `${tracks.length} songs added` : 'Suno song added',
      description: 'Find it in your Media bin on the left.',
    });
  }, [toast]);

  // Sound Fx: download the Freesound file and drop it in the Media bin as an
  // audio item, prefixed "FX ·" so effects stand out from songs in the bin.
  const loadSoundFx = useCallback(async (sound: FreesoundSound) => {
    const file = await downloadSound(sound);
    const assetId = await putAsset(file);
    const assetUrl = await getAssetUrl(assetId);
    const dur = assetUrl ? await probeDuration(assetUrl) : sound.duration;
    // Drop the original file extension — the saved clip may be a different
    // format (e.g. an AIFF downloaded as the MP3 preview).
    const label = sound.name.replace(/\.(wav|aiff?|ogg|mp3|m4a|flac|aac)$/i, '');
    setStockItems(prev => [{
      id: `stock-${assetId}`, kind: 'audio',
      name: `FX · ${label}`.slice(0, 80), title: label,
      duration: dur, assetId,
    }, ...prev]);
    toast({ title: 'Sound effect added', description: 'Find it under Music & Sound FX in the Media bin.' });
  }, [toast]);

  // Place a Media-bin stock item onto the correct track.
  const onAddStock = useCallback((s: StockMediaItem) => {
    if (s.kind === 'photo' && s.dataUrl) {
      const id = addImageOverlay(playhead, s.dataUrl);
      setSelectedOverlayId(id); setSelectedClipId(null); setSelectedAudioId(null);
    } else if (s.kind === 'audio' && s.assetId) {
      const id = addAudioClip(s.assetId, s.name, s.duration, playhead);
      setSelectedAudioId(id); setSelectedClipId(null); setSelectedOverlayId(null);
    } else if (s.kind === 'video') {
      const id = addRecording({ recordingId: s.id, name: s.name, sourceDuration: s.duration });
      setSelectedClipId(id); setSelectedAudioId(null); setSelectedOverlayId(null);
    }
  }, [playhead, addImageOverlay, addAudioClip, addRecording]);

  // Delete a recording — removes it from the Studio Archive library (cloud
  // storage + DB row) and purges any clips it feeds on this timeline.
  const onDeleteRecording = useCallback(async (rec: Recording) => {
    project.clips.filter(c => c.recordingId === rec.id).forEach(c => {
      removeClip(c.id);
      if (selectedClipId === c.id) setSelectedClipId(null);
    });
    await deleteRecording(rec.id);
  }, [project, removeClip, selectedClipId, deleteRecording]);

  // Remove a stock item from the editor: drop its timeline references, forget
  // its IndexedDB blob, and take it out of the bin. (Stock isn't in the Archive.)
  const onDeleteStock = useCallback(async (item: StockMediaItem) => {
    if (item.kind === 'video') {
      project.clips.filter(c => c.recordingId === item.id).forEach(c => {
        removeClip(c.id);
        if (selectedClipId === c.id) setSelectedClipId(null);
      });
    } else if (item.kind === 'audio' && item.assetId) {
      project.audioClips.filter(a => a.assetId === item.assetId).forEach(a => {
        removeAudioClip(a.id);
        if (selectedAudioId === a.id) setSelectedAudioId(null);
      });
    } else if (item.kind === 'photo' && item.dataUrl) {
      project.overlays.filter(o => o.type === 'image' && o.src === item.dataUrl).forEach(o => {
        removeOverlay(o.id);
        if (selectedOverlayId === o.id) setSelectedOverlayId(null);
      });
    }
    setStockItems(prev => prev.filter(s => s.id !== item.id));
    if (item.assetId) await deleteAsset(item.assetId);
  }, [project, removeClip, removeAudioClip, removeOverlay, selectedClipId, selectedAudioId, selectedOverlayId]);

  const stockActions: StockActions = useMemo(() => {
    const add = [{
      key: 'add', icon: Plus, label: 'Add to Media', fullWidth: true,
      title: 'Download into your Media bin', run: addStockToBin,
    }];
    return { photo: add, audio: add, video: add };
  }, [addStockToBin]);

  // Drag an overlay on the preview (transient + single undo step). Takes the
  // id from the drag itself so a just-clicked overlay drags immediately,
  // without waiting for the selection state to round-trip. Once an overlay
  // has position keyframes, dragging upserts a keyframe at the playhead
  // instead of moving the base position (repeat drags at the same playhead
  // update that keyframe, since upsert matches within one frame).
  const onOverlayDrag = useCallback((id: string, x: number, y: number) => {
    if (!overlayBefore.current) overlayBefore.current = project;
    setProjectTransient(p => {
      const o = p.overlays.find(ov => ov.id === id);
      if (!o) return p;
      const hasPosKf = o.animation?.keyframes?.some(k => k.props.x !== undefined || k.props.y !== undefined);
      if (hasPosKf) {
        const tLocal = Math.max(0, Math.min(o.end - o.start, playhead - o.start));
        return updateOverlayById(p, id, { animation: upsertKeyframe(o.animation, tLocal, { x, y }) });
      }
      return updateOverlayById(p, id, { x, y });
    });
  }, [project, playhead, setProjectTransient]);

  const onOverlayDragEnd = useCallback(() => {
    if (overlayBefore.current) { commitHistory(overlayBefore.current); overlayBefore.current = null; }
  }, [commitHistory]);

  // Keyboard shortcuts (ignored while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (!mod && e.key.toLowerCase() === 's') { e.preventDefault(); onSplit(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedAudioId) { e.preventDefault(); removeAudioClip(selectedAudioId); setSelectedAudioId(null); }
        else if (selectedOverlayId) { e.preventDefault(); removeOverlay(selectedOverlayId); setSelectedOverlayId(null); }
        else if (selectedClipId) { e.preventDefault(); removeClip(selectedClipId); setSelectedClipId(null); }
      } else if (e.key === 'ArrowLeft') { seek(playhead - (e.shiftKey ? 1 : 1 / 30)); }
      else if (e.key === 'ArrowRight') { seek(playhead + (e.shiftKey ? 1 : 1 / 30)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, undo, redo, onSplit, selectedAudioId, selectedOverlayId, selectedClipId, removeAudioClip, removeOverlay, removeClip, seek, playhead]);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <header className="h-12 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
              <Radio className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground tracking-tight">StreamForge Editor</span>
          </div>
          <input
            value={project.name}
            onChange={e => rename(e.target.value)}
            className="text-sm bg-transparent border border-transparent hover:border-border focus:border-primary rounded px-2 py-1 text-muted-foreground focus:text-foreground focus:outline-none w-44"
          />
          <Select
            value={aspectKey}
            onValueChange={k => { const a = ASPECTS.find(x => x.key === k); if (a) setCanvasSize(a.w, a.h); }}
          >
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ASPECTS.map(a => <SelectItem key={a.key} value={a.key} className="text-xs">{a.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-2" disabled={!duration || exporting} title="Export the timeline">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => onExport('download')} className="gap-2">
              <Download className="h-4 w-4" /> Download (.webm)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => { setExcerptName(project.name || 'export'); setExcerptDialogOpen(true); }}
              className="gap-2"
            >
              <Library className="h-4 w-4" /> Save to Media Library (Excerpts)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <Dialog open={excerptDialogOpen} onOpenChange={setExcerptDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save to Media Library</DialogTitle>
            <DialogDescription>
              Name this excerpt before it's saved to Studio → Media Library → Excerpts.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={e => {
              e.preventDefault();
              const name = excerptName.trim();
              if (!name) return;
              setExcerptDialogOpen(false);
              onExport('excerpt', name);
            }}
          >
            <Input
              autoFocus
              value={excerptName}
              onChange={e => setExcerptName(e.target.value)}
              onFocus={e => e.target.select()}
              placeholder="Excerpt name"
              maxLength={120}
              aria-label="Excerpt name"
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setExcerptDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!excerptName.trim()} className="gap-2">
                <Library className="h-4 w-4" /> Save excerpt
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="flex-1 flex min-h-0">
        <MediaBin
          recordings={recordings} loading={loading} onAdd={handleAdd}
          stockItems={stockItems} onAddStock={onAddStock}
          onDeleteRecording={onDeleteRecording} onDeleteStock={onDeleteStock}
          onRenameRecording={renameRecording} onRenameStock={onRenameStock}
          resolveAudioUrl={item => (item.assetId ? getAssetUrl(item.assetId) : Promise.resolve(null))}
        />

        <div className="flex-1 flex flex-col min-h-0 relative">
          <PreviewCanvas
            project={project}
            playhead={playhead}
            playing={playing}
            resolve={resolveClip}
            resolveAudio={resolveAudio}
            onPlayheadChange={setPlayhead}
            onEnded={onEnded}
            selectedOverlayId={selectedOverlayId}
            selectedClipId={selectedClipId}
            onOverlayDrag={onOverlayDrag}
            onOverlayDragEnd={onOverlayDragEnd}
            setProjectTransient={setProjectTransient}
            commitHistory={commitHistory}
            onSelectClip={id => { setSelectedClipId(id); setSelectedOverlayId(null); setSelectedAudioId(null); }}
            onSelectOverlay={id => { setSelectedOverlayId(id); setSelectedClipId(null); setSelectedAudioId(null); }}
          />

          <div className="h-11 border-t border-border bg-card/60 flex items-center justify-center gap-3 shrink-0">
            <button onClick={() => seek(0)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="Back to start">
              <SkipBack className="h-4 w-4" />
            </button>
            <button onClick={togglePlay} disabled={!duration}
              className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 transition-colors"
              title={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </button>
            <span className="text-xs font-mono text-muted-foreground tabular-nums">
              {formatTimecode(playhead)} / {formatTimecode(duration)}
            </span>
          </div>
        </div>

        <PropertiesPanel
          project={project}
          playhead={playhead}
          clip={selectedClip}
          overlay={selectedOverlay}
          audio={selectedAudio}
          setProjectTransient={setProjectTransient}
          commitHistory={commitHistory}
          onRemoveClip={id => { removeClip(id); setSelectedClipId(null); }}
          onRemoveOverlay={id => { removeOverlay(id); setSelectedOverlayId(null); }}
          onRemoveAudio={id => { removeAudioClip(id); setSelectedAudioId(null); }}
          onStabilize={onStabilize}
          stabilizingClipId={stabilizingClipId}
          stabilizePct={stabilizePct}
        />
      </div>

      <Timeline
        project={project}
        playhead={playhead}
        selectedClipId={selectedClipId}
        selectedOverlayId={selectedOverlayId}
        selectedAudioId={selectedAudioId}
        onSeek={seek}
        onSelectClip={setSelectedClipId}
        onSelectOverlay={setSelectedOverlayId}
        onSelectAudio={setSelectedAudioId}
        setProjectTransient={setProjectTransient}
        commitHistory={commitHistory}
        onSplit={onSplit}
        onAddText={onAddText}
        onAddLowerThird={onAddLowerThird}
        onAddImage={() => imageInputRef.current?.click()}
        onOpenMusic={() => setMusicOpen(true)}
        onOpenStock={() => setStockOpen(true)}
        onOpenVideoCut={() => setVideoCutOpen(true)}
        onOpenMotion={() => setMotionOpen(true)}
        undo={undo}
        redo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      <input ref={imageInputRef} type="file" accept="image/*" onChange={onImageFile} className="hidden" />
      <input ref={audioInputRef} type="file" accept="audio/*" onChange={onAudioFile} className="hidden" />

      {/* Stock media browser — search free photos/audio/video and add them to
          the Media bin on the left as "Stock". */}
      <Sheet open={stockOpen} onOpenChange={setStockOpen}>
        <SheetContent side="right" className="w-[380px] sm:max-w-[380px] flex flex-col p-0 gap-0">
          <SheetHeader className="px-4 pt-4 pb-3 border-b border-border text-left">
            <SheetTitle className="text-sm">Stock Media</SheetTitle>
            <SheetDescription className="text-xs">
              Free Creative-Commons photos, audio &amp; video. Add to your Media bin, then drop onto the timeline.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <StockMediaBrowser actions={stockActions} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Motion Graphics generator — turn a prompt into an animated title,
          lower third, or badge and add it to the Media bin as "Motion". */}
      <Sheet open={motionOpen} onOpenChange={setMotionOpen}>
        <SheetContent side="right" className="w-[380px] sm:max-w-[380px] flex flex-col p-0 gap-0">
          <SheetHeader className="px-4 pt-4 pb-3 border-b border-border text-left">
            <SheetTitle className="text-sm">Motion Graphics</SheetTitle>
            <SheetDescription className="text-xs">
              Generate an animated title, lower third, or badge. Add it to your Media bin, then drop it onto the timeline.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <MotionGraphicsBrowser actions={motionActions} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Sound Fx browser — connect a Freesound account, search effects, and
          add them to the Media bin's Music & Sound FX tab. */}
      <Sheet open={soundFxOpen} onOpenChange={setSoundFxOpen}>
        <SheetContent side="right" className="w-[380px] sm:max-w-[380px] flex flex-col p-0 gap-0">
          <SheetHeader className="px-4 pt-4 pb-3 border-b border-border text-left">
            <SheetTitle className="text-sm">Sound Fx</SheetTitle>
            <SheetDescription className="text-xs">
              Search Freesound's community sound effects. Add to your Media bin, then drop onto the timeline.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <SoundFxPanel onAdd={loadSoundFx} />
          </div>
        </SheetContent>
      </Sheet>

      <VideoCutDialog open={videoCutOpen} onOpenChange={setVideoCutOpen} onLoad={loadVideoCut} />
      <AddMusicDialog
        open={musicOpen}
        onOpenChange={setMusicOpen}
        onUploadFile={() => audioInputRef.current?.click()}
        onLoadSuno={loadSuno}
        onOpenSoundFx={() => setSoundFxOpen(true)}
      />

      {/* Export progress */}
      {exporting && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Exporting your video…</h3>
            </div>
            <div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${Math.round(exportPct * 100)}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 font-mono">{Math.round(exportPct * 100)}%</p>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Recording in real time — keep this window focused and in the foreground until it finishes.
            </p>
            <Button size="sm" variant="outline" className="w-full" onClick={() => abortRef.current?.abort()}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
