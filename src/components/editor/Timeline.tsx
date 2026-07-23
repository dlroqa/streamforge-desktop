import { useRef, useState } from 'react';
import {
  type EditorProject, clipLength, projectDuration, formatTimecode,
  setClipTrim, reorderBaseClipTo, moveClipInTime, moveClipToTrack, clipTrack,
  BASE_TRACK, UPPER_TRACK, updateOverlayById, updateAudioClipById, audioClipLength,
  retimeOverlayKeyframe,
} from '@/lib/editorProject';
import {
  Film, Scissors, Undo2, Redo2, ZoomIn, ZoomOut, Type, Image as ImageIcon, Music, Images, Clapperboard, Captions, Layers, Wand2,
} from 'lucide-react';

const LAYER_H = 44;   // upper video layer lane
const TRACK_H = 56;   // base video lane
const OVERLAY_H = 32;
const AUDIO_H = 32;
const RULER_H = 24;
const MIN_PPS = 20;
const MAX_PPS = 400;

type Drag =
  | { kind: 'scrub' }
  | { kind: 'move' | 'trim-l' | 'trim-r'; clipId: string; before: EditorProject }
  | { kind: 'u-move'; clipId: string; grabOffset: number; before: EditorProject }
  | { kind: 'o-move'; overlayId: string; grabOffset: number; before: EditorProject }
  | { kind: 'o-trim-l' | 'o-trim-r'; overlayId: string; before: EditorProject }
  | { kind: 'kf-move'; overlayId: string; kfIndex: number; before: EditorProject }
  | { kind: 'a-move'; audioId: string; grabOffset: number; before: EditorProject }
  | { kind: 'a-trim-l' | 'a-trim-r'; audioId: string; before: EditorProject };

export function Timeline({
  project, playhead, selectedClipId, selectedOverlayId, selectedAudioId,
  onSeek, onSelectClip, onSelectOverlay, onSelectAudio,
  setProjectTransient, commitHistory,
  onSplit, onAddText, onAddLowerThird, onAddImage, onOpenMusic, onOpenStock, onOpenVideoCut, onOpenMotion, undo, redo, canUndo, canRedo,
}: {
  project: EditorProject;
  playhead: number;
  selectedClipId: string | null;
  selectedOverlayId: string | null;
  selectedAudioId: string | null;
  onSeek: (t: number) => void;
  onSelectClip: (id: string | null) => void;
  onSelectOverlay: (id: string | null) => void;
  onSelectAudio: (id: string | null) => void;
  setProjectTransient: (producer: (p: EditorProject) => EditorProject) => void;
  commitHistory: (before: EditorProject) => void;
  onSplit: () => void;
  onAddText: () => void;
  onAddLowerThird: () => void;
  onAddImage: () => void;
  onOpenMusic: () => void;
  onOpenStock: () => void;
  onOpenVideoCut: () => void;
  onOpenMotion: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [pxPerSec, setPxPerSec] = useState(80);
  const dur = projectDuration(project);
  const width = Math.max((dur + 4) * pxPerSec, 600);

  const baseClips = project.clips.filter(c => clipTrack(c) === BASE_TRACK);
  const upperClips = project.clips.filter(c => clipTrack(c) === UPPER_TRACK);

  const secAt = (clientX: number): number => {
    const el = laneRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + el.scrollLeft) / pxPerSec);
  };

  // Which video lane a Y coordinate is over (for drag-between-tracks), or null
  // if the pointer isn't over a video lane. Lanes stack: ruler, upper, base.
  const trackAtY = (clientY: number): number | null => {
    const el = laneRef.current;
    if (!el) return null;
    const y = clientY - el.getBoundingClientRect().top;
    if (y >= RULER_H && y < RULER_H + LAYER_H) return UPPER_TRACK;
    if (y >= RULER_H + LAYER_H && y < RULER_H + LAYER_H + TRACK_H) return BASE_TRACK;
    return null;
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    const sec = secAt(e.clientX);
    switch (d.kind) {
      case 'scrub': onSeek(sec); break;
      case 'trim-l':
        setProjectTransient(p => setClipTrim(p, d.clipId, { inPoint: edgeToInPoint(p, d.clipId, sec) }));
        break;
      case 'trim-r':
        setProjectTransient(p => setClipTrim(p, d.clipId, { outPoint: edgeToInPoint(p, d.clipId, sec) }));
        break;
      case 'move': // base track: reorder within the gapless sequence
        setProjectTransient(p => reorderBaseClipTo(p, d.clipId, sec));
        break;
      case 'u-move': // upper layer: free horizontal positioning
        setProjectTransient(p => moveClipInTime(p, d.clipId, Math.max(0, sec - d.grabOffset)));
        break;
      case 'o-move':
        setProjectTransient(p => {
          const o = p.overlays.find(ov => ov.id === d.overlayId);
          if (!o) return p;
          const len = o.end - o.start;
          const start = Math.max(0, sec - d.grabOffset);
          return updateOverlayById(p, d.overlayId, { start, end: start + len });
        });
        break;
      case 'o-trim-l':
        setProjectTransient(p => updateOverlayById(p, d.overlayId, { start: sec }));
        break;
      case 'o-trim-r':
        setProjectTransient(p => updateOverlayById(p, d.overlayId, { end: sec }));
        break;
      case 'kf-move': {
        setProjectTransient(p => {
          const o = p.overlays.find(ov => ov.id === d.overlayId);
          return o ? retimeOverlayKeyframe(p, d.overlayId, d.kfIndex, sec - o.start) : p;
        });
        // Playhead follows the diamond so the preview scrubs the keyframe's
        // moment and the panel keeps showing this keyframe's controls. The
        // window can't change mid-drag, so `before` is safe to clamp against.
        const o0 = d.before.overlays.find(ov => ov.id === d.overlayId);
        if (o0) onSeek(Math.max(o0.start, Math.min(o0.end - 0.01, sec)));
        break;
      }
      case 'a-move':
        setProjectTransient(p => updateAudioClipById(p, d.audioId, { timelineStart: Math.max(0, sec - d.grabOffset) }));
        break;
      case 'a-trim-l': {
        setProjectTransient(p => {
          const a = p.audioClips.find(x => x.id === d.audioId);
          if (!a) return p;
          return updateAudioClipById(p, d.audioId, { inPoint: a.inPoint + (sec - a.timelineStart) });
        });
        break;
      }
      case 'a-trim-r': {
        setProjectTransient(p => {
          const a = p.audioClips.find(x => x.id === d.audioId);
          if (!a) return p;
          return updateAudioClipById(p, d.audioId, { outPoint: a.inPoint + (sec - a.timelineStart) });
        });
        break;
      }
    }
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
    if (!d || d.kind === 'scrub') return;
    // Drag-between-lanes: if a clip move ended over the OTHER video lane,
    // reassign its track. Base→upper lands under the cursor (free); upper→base
    // re-flows into the gapless sequence.
    if (d.kind === 'move' || d.kind === 'u-move') {
      const target = trackAtY(lastPointer.current.y);
      const clip = project.clips.find(c => c.id === d.clipId);
      if (clip && target !== null && target !== clipTrack(clip)) {
        const dropSec = Math.max(0, secAt(lastPointer.current.x));
        setProjectTransient(p => {
          const moved = moveClipToTrack(p, d.clipId, target);
          return target === UPPER_TRACK ? moveClipInTime(moved, d.clipId, dropSec) : moved;
        });
      }
    }
    commitHistory(d.before);
  };

  const startDrag = (d: Drag) => {
    dragRef.current = d;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  };

  return (
    <div className="border-t border-border bg-card/60 flex flex-col shrink-0" style={{ height: LAYER_H + TRACK_H + OVERLAY_H + AUDIO_H + 100 }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60">
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mr-2">
            <Film className="h-3.5 w-3.5" /> Timeline
          </span>
          <ToolBtn onClick={onSplit} title="Cut at playhead — the selected clip, or all media (S)"><Scissors className="h-3.5 w-3.5" /></ToolBtn>
          <ToolBtn onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)"><Undo2 className="h-3.5 w-3.5" /></ToolBtn>
          <ToolBtn onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)"><Redo2 className="h-3.5 w-3.5" /></ToolBtn>
          <div className="w-px h-4 bg-border mx-1" />
          <ToolBtn onClick={onAddText} title="Add text overlay"><Type className="h-3.5 w-3.5" /></ToolBtn>
          <ToolBtn onClick={onAddLowerThird} title="Add animated lower third"><Captions className="h-3.5 w-3.5" /></ToolBtn>
          <ToolBtn onClick={onAddImage} title="Add image overlay"><ImageIcon className="h-3.5 w-3.5" /></ToolBtn>
          <ToolBtn onClick={onOpenMusic} title="Add music — upload a file or load from Suno"><Music className="h-3.5 w-3.5" /></ToolBtn>
          <ToolBtn onClick={onOpenStock} title="Browse free stock photos, audio & video"><Images className="h-3.5 w-3.5" /></ToolBtn>
          <ToolBtn onClick={onOpenVideoCut} title="Video Cut — load a video from X, Facebook, or a direct URL"><Clapperboard className="h-3.5 w-3.5" /></ToolBtn>
          <ToolBtn onClick={onOpenMotion} title="Motion Graphics — generate an animated title, lower third, or badge"><Wand2 className="h-3.5 w-3.5" /></ToolBtn>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-muted-foreground">
            {formatTimecode(playhead)} / {formatTimecode(dur)}
          </span>
          <ToolBtn onClick={() => setPxPerSec(p => Math.max(MIN_PPS, p / 1.5))} title="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></ToolBtn>
          <ToolBtn onClick={() => setPxPerSec(p => Math.min(MAX_PPS, p * 1.5))} title="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></ToolBtn>
        </div>
      </div>

      <div
        ref={laneRef}
        className="relative flex-1 overflow-x-auto overflow-y-hidden"
        onPointerDown={e => { onSelectClip(null); onSelectOverlay(null); onSelectAudio(null); onSeek(secAt(e.clientX)); startDrag({ kind: 'scrub' }); }}
      >
        <div className="relative" style={{ width }}>
          {/* Ruler */}
          <div className="relative h-6 border-b border-border/50 select-none">
            {rulerTicks(dur).map(s => (
              <div key={s} className="absolute top-0 h-full" style={{ left: s * pxPerSec }}>
                <div className={`w-px ${s % 5 === 0 ? 'h-3 bg-muted-foreground/50' : 'h-1.5 bg-muted-foreground/25'}`} />
                {s % 5 === 0 && (
                  <span className="absolute top-2.5 left-1 text-[9px] font-mono text-muted-foreground/60">{formatTimecode(s)}</span>
                )}
              </div>
            ))}
          </div>

          {/* Upper video layer (free-positioned; composites over the base) */}
          <div className="relative" style={{ height: LAYER_H }}>
            {upperClips.length === 0 && (
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50 flex items-center gap-1 pointer-events-none">
                <Layers className="h-3 w-3" /> Layer 2 — drag a clip up here to blend it over the base
              </span>
            )}
            {upperClips.map(clip => {
              const selected = clip.id === selectedClipId;
              return (
                <div
                  key={clip.id}
                  onPointerDown={e => {
                    e.stopPropagation();
                    onSelectClip(clip.id); onSelectOverlay(null); onSelectAudio(null); onSeek(secAt(e.clientX));
                    startDrag({ kind: 'u-move', clipId: clip.id, grabOffset: secAt(e.clientX) - clip.timelineStart, before: project });
                  }}
                  className={`group absolute top-1 rounded-md overflow-hidden cursor-grab active:cursor-grabbing border transition-colors ${
                    selected ? 'border-primary ring-1 ring-primary/60' : 'border-border/70 hover:border-primary/50'
                  }`}
                  style={{
                    left: clip.timelineStart * pxPerSec,
                    width: Math.max(clipLength(clip) * pxPerSec, 10),
                    height: LAYER_H - 8,
                    background: 'linear-gradient(180deg, rgba(139,92,246,0.30), rgba(139,92,246,0.12))',
                  }}
                  title={clip.name}
                >
                  <div className="px-2 py-0.5 text-[11px] font-medium text-foreground truncate pointer-events-none">{clip.name}</div>
                  <div onPointerDown={e => { e.stopPropagation(); onSelectClip(clip.id); startDrag({ kind: 'trim-l', clipId: clip.id, before: project }); }}
                    className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-primary/0 group-hover:bg-primary/60" title="Trim start" />
                  <div onPointerDown={e => { e.stopPropagation(); onSelectClip(clip.id); startDrag({ kind: 'trim-r', clipId: clip.id, before: project }); }}
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-primary/0 group-hover:bg-primary/60" title="Trim end" />
                </div>
              );
            })}
          </div>

          {/* Base video track (gapless) */}
          <div className="relative border-t border-border/40" style={{ height: TRACK_H }}>
            {baseClips.map(clip => {
              const selected = clip.id === selectedClipId;
              return (
                <div
                  key={clip.id}
                  onPointerDown={e => {
                    e.stopPropagation();
                    onSelectClip(clip.id); onSelectOverlay(null); onSelectAudio(null); onSeek(secAt(e.clientX));
                    startDrag({ kind: 'move', clipId: clip.id, before: project });
                  }}
                  className={`group absolute top-1 rounded-md overflow-hidden cursor-grab active:cursor-grabbing border transition-colors ${
                    selected ? 'border-primary ring-1 ring-primary/60' : 'border-border/70 hover:border-primary/50'
                  }`}
                  style={{
                    left: clip.timelineStart * pxPerSec,
                    width: Math.max(clipLength(clip) * pxPerSec, 10),
                    height: TRACK_H - 8,
                    background: 'linear-gradient(180deg, rgba(6,180,224,0.28), rgba(6,180,224,0.12))',
                  }}
                  title={clip.name}
                >
                  <div className="px-2 py-1 text-[11px] font-medium text-foreground truncate pointer-events-none">{clip.name}</div>
                  <div className="px-2 text-[10px] font-mono text-muted-foreground pointer-events-none">{formatTimecode(clipLength(clip))}</div>
                  <div onPointerDown={e => { e.stopPropagation(); onSelectClip(clip.id); startDrag({ kind: 'trim-l', clipId: clip.id, before: project }); }}
                    className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-primary/0 group-hover:bg-primary/60" title="Trim start" />
                  <div onPointerDown={e => { e.stopPropagation(); onSelectClip(clip.id); startDrag({ kind: 'trim-r', clipId: clip.id, before: project }); }}
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-primary/0 group-hover:bg-primary/60" title="Trim end" />
                </div>
              );
            })}
          </div>

          {/* Overlay track */}
          <div className="relative border-t border-border/40" style={{ height: OVERLAY_H }}>
            {project.overlays.map(o => {
              const selected = o.id === selectedOverlayId;
              const label = o.type === 'text' ? (o.text || 'Text')
                : o.type === 'lowerThird' ? (o.title || 'Lower third') : 'Image';
              return (
                <div
                  key={o.id}
                  onPointerDown={e => {
                    e.stopPropagation();
                    onSelectOverlay(o.id); onSelectClip(null); onSelectAudio(null); onSeek(secAt(e.clientX));
                    startDrag({ kind: 'o-move', overlayId: o.id, grabOffset: secAt(e.clientX) - o.start, before: project });
                  }}
                  className={`group absolute top-1 rounded overflow-hidden cursor-grab active:cursor-grabbing border transition-colors flex items-center ${
                    selected ? 'border-accent ring-1 ring-accent/60' : 'border-border/70 hover:border-accent/50'
                  }`}
                  style={{
                    left: o.start * pxPerSec,
                    width: Math.max((o.end - o.start) * pxPerSec, 10),
                    height: OVERLAY_H - 8,
                    background: 'linear-gradient(180deg, rgba(249,158,31,0.28), rgba(249,158,31,0.12))',
                  }}
                  title={label}
                >
                  <span className="px-2 text-[10px] font-medium text-foreground truncate pointer-events-none">{label}</span>
                  {/* Keyframe diamonds — click to jump the playhead, drag to retime */}
                  {(o.animation?.keyframes ?? []).map((kf, i) => (
                    <div
                      key={i}
                      onPointerDown={e => {
                        e.stopPropagation();
                        onSelectOverlay(o.id); onSelectClip(null); onSelectAudio(null);
                        onSeek(o.start + kf.t);
                        startDrag({ kind: 'kf-move', overlayId: o.id, kfIndex: i, before: project });
                      }}
                      className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] bg-accent ring-1 ring-background cursor-ew-resize hover:scale-125 transition-transform"
                      style={{ left: kf.t * pxPerSec }}
                      title={`Keyframe at ${formatTimecode(o.start + kf.t)} — drag to retime`}
                    />
                  ))}
                  <div onPointerDown={e => { e.stopPropagation(); onSelectOverlay(o.id); startDrag({ kind: 'o-trim-l', overlayId: o.id, before: project }); }}
                    className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-accent/0 group-hover:bg-accent/60" title="Trim start" />
                  <div onPointerDown={e => { e.stopPropagation(); onSelectOverlay(o.id); startDrag({ kind: 'o-trim-r', overlayId: o.id, before: project }); }}
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-accent/0 group-hover:bg-accent/60" title="Trim end" />
                </div>
              );
            })}
          </div>

          {/* Audio (music / voiceover) track */}
          <div className="relative border-t border-border/40" style={{ height: AUDIO_H }}>
            {project.audioClips.map(a => {
              const selected = a.id === selectedAudioId;
              return (
                <div
                  key={a.id}
                  onPointerDown={e => {
                    e.stopPropagation();
                    onSelectAudio(a.id); onSelectClip(null); onSelectOverlay(null); onSeek(secAt(e.clientX));
                    startDrag({ kind: 'a-move', audioId: a.id, grabOffset: secAt(e.clientX) - a.timelineStart, before: project });
                  }}
                  className={`group absolute top-1 rounded overflow-hidden cursor-grab active:cursor-grabbing border transition-colors flex items-center ${
                    selected ? 'border-emerald-400 ring-1 ring-emerald-400/60' : 'border-border/70 hover:border-emerald-400/50'
                  }`}
                  style={{
                    left: a.timelineStart * pxPerSec,
                    width: Math.max(audioClipLength(a) * pxPerSec, 10),
                    height: AUDIO_H - 8,
                    background: 'linear-gradient(180deg, rgba(16,185,129,0.28), rgba(16,185,129,0.12))',
                  }}
                  title={a.name}
                >
                  <Music className="h-3 w-3 ml-1.5 text-emerald-300 shrink-0 pointer-events-none" />
                  <span className="px-1.5 text-[10px] font-medium text-foreground truncate pointer-events-none">{a.name}</span>
                  <div onPointerDown={e => { e.stopPropagation(); onSelectAudio(a.id); startDrag({ kind: 'a-trim-l', audioId: a.id, before: project }); }}
                    className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-emerald-400/0 group-hover:bg-emerald-400/60" title="Trim start" />
                  <div onPointerDown={e => { e.stopPropagation(); onSelectAudio(a.id); startDrag({ kind: 'a-trim-r', audioId: a.id, before: project }); }}
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-emerald-400/0 group-hover:bg-emerald-400/60" title="Trim end" />
                </div>
              );
            })}
          </div>

          {/* Playhead */}
          <div className="absolute top-0 bottom-0 w-px bg-live pointer-events-none z-10" style={{ left: playhead * pxPerSec }}>
            <div className="absolute -top-0.5 -left-[5px] w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-live" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({ onClick, disabled, title, children }: {
  onClick: () => void; disabled?: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40 disabled:hover:bg-transparent transition-colors">
      {children}
    </button>
  );
}

function rulerTicks(dur: number): number[] {
  const ticks: number[] = [];
  for (let s = 0; s <= dur + 4; s++) ticks.push(s);
  return ticks;
}

// A clip edge at timeline position `edgeSec` maps to this source in/out point
// (speed-aware: a timeline second covers `speed` source seconds).
function edgeToInPoint(project: EditorProject, clipId: string, edgeSec: number): number {
  const c = project.clips.find(cl => cl.id === clipId);
  if (!c) return 0;
  return c.inPoint + (edgeSec - c.timelineStart) * (c.speed || 1);
}
