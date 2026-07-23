import { useEffect, useRef, useState } from 'react';
import {
  type EditorProject, type EditorOverlay,
  clipAtTime, clipsAtTime, clipEnd, sourceTimeFor, projectDuration, clipLength, fadeMultiplier,
  audioClipsAtTime, audioClipLength, updateClipById, overlaysAtTime, clipSourceId,
} from '@/lib/editorProject';
import { renderFrame, seekVideosTo, reframeRect, overlayBounds } from '@/lib/editorRender';
import { sampleOverlayMotion } from '@/lib/overlayAnimation';
import { Move, Maximize2 } from 'lucide-react';

/**
 * Canvas preview + playback engine. Renders the clip covering the playhead and
 * any overlays for that time. During playback the active clip's <video> plays
 * natively (audio + timing in sync) and drives the playhead.
 */
export function PreviewCanvas({
  project, playhead, playing, resolve, resolveAudio, onPlayheadChange, onEnded,
  selectedOverlayId, selectedClipId, onOverlayDrag, onOverlayDragEnd,
  setProjectTransient, commitHistory, onSelectClip, onSelectOverlay,
}: {
  project: EditorProject;
  playhead: number;
  playing: boolean;
  resolve: (recordingId: string) => Promise<string | null>;
  resolveAudio: (assetId: string) => Promise<string | null>;
  onPlayheadChange: (t: number) => void;
  onEnded: () => void;
  selectedOverlayId: string | null;
  selectedClipId: string | null;
  onOverlayDrag: (id: string, x: number, y: number) => void;
  onOverlayDragEnd: () => void;
  setProjectTransient: (producer: (p: EditorProject) => EditorProject) => void;
  commitHistory: (before: EditorProject) => void;
  onSelectClip: (id: string) => void;
  onSelectOverlay: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const playheadRef = useRef(playhead);
  const playingRef = useRef(playing);
  const projectRef = useRef(project);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [reframing, setReframing] = useState(false);

  playheadRef.current = playhead;
  playingRef.current = playing;
  projectRef.current = project;

  // Hidden <video> per clip recording. Media (stock blobs, cloud/local
  // recordings) may only resolve after mount — e.g. on refresh the bin
  // hydrates from IndexedDB async — so we retry resolution for any id not yet
  // resolved whenever `resolve` changes, instead of only at element creation.
  // One <video> PER CLIP (keyed by clip id, not source) so two overlapping
  // layers never share an element. Each element's src is resolved from the
  // clip's SOURCE (clipSourceId → recording or stabilized copy); we track the
  // resolved source per clip id and re-resolve if it changes (e.g. stabilize
  // toggled), since the clip id stays stable across that switch.
  const resolvedVideoRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const needed = new Map(project.clips.map(c => [c.id, clipSourceId(c)] as const));
    for (const [id, srcId] of needed) {
      let v = videosRef.current.get(id);
      if (!v) {
        v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        videosRef.current.set(id, v);
      }
      if (resolvedVideoRef.current.get(id) !== srcId) {
        const el = v;
        resolve(srcId).then(url => { if (url) { el.src = url; resolvedVideoRef.current.set(id, srcId); } });
      }
    }
    for (const [id, v] of videosRef.current) {
      if (!needed.has(id)) {
        v.pause(); v.src = ''; videosRef.current.delete(id); resolvedVideoRef.current.delete(id);
      }
    }
  }, [project.clips, resolve]);

  // Hidden <audio> per music-track clip (same retry-until-resolved approach).
  const resolvedAudioRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const needed = new Set(project.audioClips.map(a => a.id));
    for (const a of project.audioClips) {
      let el = audiosRef.current.get(a.id);
      if (!el) {
        el = document.createElement('audio');
        el.preload = 'auto';
        audiosRef.current.set(a.id, el);
      }
      if (!resolvedAudioRef.current.has(a.id)) {
        const node = el;
        resolveAudio(a.assetId).then(url => { if (url) { node.src = url; resolvedAudioRef.current.add(a.id); } });
      }
    }
    for (const [id, el] of audiosRef.current) {
      if (!needed.has(id)) {
        el.pause(); el.src = ''; audiosRef.current.delete(id); resolvedAudioRef.current.delete(id);
      }
    }
  }, [project.audioClips, resolveAudio]);

  // Preload overlay images
  useEffect(() => {
    for (const o of project.overlays) {
      if (o.type === 'image' && o.src && !imagesRef.current.has(o.src)) {
        const img = new Image();
        img.src = o.src;
        imagesRef.current.set(o.src, img);
      }
    }
  }, [project.overlays]);

  // Track the on-screen canvas rect so the overlay drag handle can be placed.
  useEffect(() => {
    const c = canvasRef.current;
    const container = c?.parentElement;
    if (!c || !container) return;
    const update = () => {
      const cr = c.getBoundingClientRect();
      const pr = container.getBoundingClientRect();
      setRect({ left: cr.left - pr.left, top: cr.top - pr.top, width: cr.width, height: cr.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(c);
    ro.observe(container);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);

  // Always-on render loop — draws the frame at the current playhead.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const p = projectRef.current;
      if (!playingRef.current) seekVideosTo(p, playheadRef.current, videosRef.current);
      renderFrame(ctx, p, playheadRef.current, videosRef.current, imagesRef.current);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Playback — a WALL CLOCK drives the playhead and the active clip's <video>
  // is kept synced to it. (Deriving the playhead from the video's currentTime
  // makes it jump/cycle at cut boundaries where two clips share one <video>,
  // and mis-handles overlay-only tail regions — so we don't do that.)
  useEffect(() => {
    if (!playing) {
      for (const v of videosRef.current.values()) v.pause();
      for (const el of audiosRef.current.values()) el.pause();
      return;
    }
    let raf = 0;
    let start = performance.now() - playheadRef.current * 1000;
    const loop = () => {
      const p = projectRef.current;
      const dur = projectDuration(p);
      let t = (performance.now() - start) / 1000;

      // Hold the clock while the active clip's video can't render (mid-seek,
      // or no decodable frame yet). Studio recordings are MediaRecorder WebMs
      // with no seek index, so a seek can take whole seconds — if the clock
      // ran on, the video would come out of the seek already >0.3s behind,
      // get re-seeked, and never re-establish playback.
      {
        const notReady = clipsAtTime(p, playheadRef.current).some(c => {
          const hv = videosRef.current.get(c.id);
          return hv && hv.readyState >= 1 && (hv.seeking || hv.readyState < 2);
        });
        if (notReady) {
          t = playheadRef.current;
          start = performance.now() - t * 1000;
        }
      }

      if (t >= dur) {
        playheadRef.current = dur;
        onPlayheadChange(dur);
        for (const v of videosRef.current.values()) v.pause();
        for (const el of audiosRef.current.values()) el.pause();
        onEnded();
        return; // stop
      }

      // All video clips active now (base + any upper layer), composited by the
      // renderer. Each plays its own element; audio mixes for free via element
      // volume (upper-layer clips are muted by default, keeping base audio).
      const active = clipsAtTime(p, t);
      const activeIds = new Set(active.map(c => c.id));
      // Pause any video whose clip isn't active
      for (const [id, v] of videosRef.current) {
        if (!activeIds.has(id) && !v.paused) v.pause();
      }
      for (const clip of active) {
        const v = videosRef.current.get(clip.id);
        if (v && v.readyState >= 1) {
          const want = sourceTimeFor(clip, t);
          // Seek only on real drift, and never while a seek is in flight —
          // re-assigning currentTime aborts the previous seek, and doing it
          // every frame (as the old `v.paused ||` clause did during play()
          // startup) starves the element so playback never resumes.
          if (!v.seeking && Math.abs(v.currentTime - want) > 0.3) {
            try { v.currentTime = want; } catch { /* mid-seek */ }
          }
          v.playbackRate = clip.speed || 1;
          v.muted = clip.muted;
          v.volume = clip.volume * fadeMultiplier(t - clip.timelineStart, clipLength(clip), clip.fadeIn || 0, clip.fadeOut || 0);
          if (v.paused) v.play().catch(() => { /* needs gesture */ });
        }
      }

      // Music / voiceover track
      const activeAudio = new Set<string>();
      for (const a of audioClipsAtTime(p, t)) {
        activeAudio.add(a.id);
        const el = audiosRef.current.get(a.id);
        if (el && el.readyState >= 1) {
          const want = a.inPoint + (t - a.timelineStart);
          if (!el.seeking && Math.abs(el.currentTime - want) > 0.3) {
            try { el.currentTime = want; } catch { /* mid-seek */ }
          }
          el.muted = a.muted;
          el.volume = a.volume * fadeMultiplier(t - a.timelineStart, audioClipLength(a), a.fadeIn || 0, a.fadeOut || 0);
          if (el.paused) el.play().catch(() => {});
        }
      }
      for (const [id, el] of audiosRef.current) {
        if (!activeAudio.has(id) && !el.paused) el.pause();
      }

      playheadRef.current = t;
      onPlayheadChange(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, onEnded, onPlayheadChange]);

  /** Drawn bounds of an overlay in canvas px (null before the canvas mounts),
   *  plus its sampled motion at the playhead so keyframed/animated overlays
   *  are grabbed where they actually appear, not at their base position. */
  const sampledFor = (o: EditorOverlay) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return null;
    const b = overlayBounds(ctx, o, project.width, project.height, imagesRef.current);
    const m = sampleOverlayMotion(
      { x: o.x, y: o.y, scale: o.scale, opacity: o.opacity },
      o.animation, playhead - o.start, o.end - o.start, project.width, project.height, b,
    );
    return { b, m, dx: (m.x - o.x) * project.width, dy: (m.y - o.y) * project.height };
  };

  // Drag an overlay on the preview. The grab offset is kept so the block
  // moves with the pointer instead of snapping its center to it; it's taken
  // from the SAMPLED center so a keyframed block drags from where it sits.
  const startOverlayDrag = (o: EditorOverlay, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const c0 = canvasRef.current;
    if (!c0) return;
    const s = sampledFor(o);
    const cr0 = c0.getBoundingClientRect();
    const grabX = (e.clientX - cr0.left) / cr0.width - (s?.m.x ?? o.x);
    const grabY = (e.clientY - cr0.top) / cr0.height - (s?.m.y ?? o.y);
    const move = (ev: PointerEvent) => {
      const c = canvasRef.current;
      if (!c) return;
      const cr = c.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (ev.clientX - cr.left) / cr.width - grabX));
      const y = Math.max(0, Math.min(1, (ev.clientY - cr.top) / cr.height - grabY));
      onOverlayDrag(o.id, x, y);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onOverlayDragEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Overlays are grabbable directly on the canvas: hit-test the block under
  // the pointer (topmost first, at its sampled position), select it and start
  // dragging; otherwise fall through to the reframe pan.
  const onCanvasPointerDown = (e: React.PointerEvent) => {
    const c = canvasRef.current;
    if (c) {
      const cr = c.getBoundingClientRect();
      const px = ((e.clientX - cr.left) / cr.width) * project.width;
      const py = ((e.clientY - cr.top) / cr.height) * project.height;
      const hits = overlaysAtTime(project, playhead);
      for (let i = hits.length - 1; i >= 0; i--) {
        const o = hits[i];
        const s = sampledFor(o);
        if (!s) continue;
        const { b, dx, dy } = s;
        if (px >= b.bx + dx && px <= b.bx + b.bw + dx && py >= b.by + dy && py <= b.by + b.bh + dy) {
          onSelectOverlay(o.id);
          startOverlayDrag(o, e);
          return;
        }
      }
    }
    startReframeDrag(e);
  };

  // ── Drag the visible clip to reframe it (pan the crop) ──
  // Prefer the SELECTED clip when it's under the playhead (so you reframe the
  // layer you picked), else the top-most active clip.
  const selForReframe = project.clips.find(c => c.id === selectedClipId) ?? null;
  const activeClip = (selForReframe && playhead >= selForReframe.timelineStart && playhead < clipEnd(selForReframe))
    ? selForReframe
    : clipAtTime(project, playhead);
  const activeVideo = activeClip ? videosRef.current.get(activeClip.id) : undefined;
  // Does the active clip overflow the frame (i.e. is there anything to pan)?
  let panAxes = { x: false, y: false };
  if (activeClip && activeVideo?.videoWidth) {
    const r = reframeRect(
      project.width, project.height, activeVideo.videoWidth, activeVideo.videoHeight,
      activeClip.fit ?? 'contain', activeClip.zoom ?? 1, activeClip.panX ?? 0.5, activeClip.panY ?? 0.5,
    );
    panAxes = { x: r.overflowX > 1, y: r.overflowY > 1 };
  }
  const canReframe = !playing && !!activeClip && (panAxes.x || panAxes.y);

  const startReframeDrag = (e: React.PointerEvent) => {
    if (!canReframe || !activeClip) return;
    const c = canvasRef.current;
    const v = videosRef.current.get(activeClip.id);
    if (!c || !v?.videoWidth) return;
    e.preventDefault();
    onSelectClip(activeClip.id);
    const before = project;
    const cr = c.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const startPanX = activeClip.panX ?? 0.5, startPanY = activeClip.panY ?? 0.5;
    const rr = reframeRect(
      project.width, project.height, v.videoWidth, v.videoHeight,
      activeClip.fit ?? 'contain', activeClip.zoom ?? 1, startPanX, startPanY,
    );
    // free space in canvas px (negative when overflowing); maps screen → pan units
    const freeX = project.width - rr.w;
    const freeY = project.height - rr.h;
    setReframing(true);
    let moved = false;
    const move = (ev: PointerEvent) => {
      // screen delta → canvas-space delta
      const dxCanvas = ((ev.clientX - startX) / cr.width) * project.width;
      const dyCanvas = ((ev.clientY - startY) / cr.height) * project.height;
      const nextX = panAxes.x && freeX !== 0 ? startPanX + dxCanvas / freeX : startPanX;
      const nextY = panAxes.y && freeY !== 0 ? startPanY + dyCanvas / freeY : startPanY;
      if (Math.abs(ev.clientX - startX) > 1 || Math.abs(ev.clientY - startY) > 1) moved = true;
      setProjectTransient(p => updateClipById(p, activeClip.id, { panX: nextX, panY: nextY }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setReframing(false);
      if (moved) commitHistory(before);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── Crop handles: drag the video's own edges to set cropL/R/T/B ──
  // Shown while paused with the active clip selected. The video rect (and its
  // handles) rotate with the clip, so a pointer delta is rotated back into the
  // clip's local space before it moves an edge.
  type CropEdge = 'cropL' | 'cropR' | 'cropT' | 'cropB';
  const cropDragging = useRef(false);
  const [, forceCropRender] = useState(0);

  const cropUi = (() => {
    if (playing || !rect || !activeClip || selectedClipId !== activeClip.id) return null;
    if (!activeVideo?.videoWidth) return null;
    const r = reframeRect(
      project.width, project.height, activeVideo.videoWidth, activeVideo.videoHeight,
      activeClip.fit ?? 'contain', activeClip.zoom ?? 1, activeClip.panX ?? 0.5, activeClip.panY ?? 0.5,
    );
    const sx = rect.width / project.width;
    const sy = rect.height / project.height;
    // Cropped window in on-screen (CSS px, unrotated) coordinates
    const left = (r.x + (activeClip.cropL ?? 0) * r.w) * sx;
    const top = (r.y + (activeClip.cropT ?? 0) * r.h) * sy;
    const width = Math.max(0, (1 - (activeClip.cropL ?? 0) - (activeClip.cropR ?? 0)) * r.w * sx);
    const height = Math.max(0, (1 - (activeClip.cropT ?? 0) - (activeClip.cropB ?? 0)) * r.h * sy);
    return { r, sx, sy, left, top, width, height, rotation: activeClip.rotation ?? 0 };
  })();

  const startCropDrag = (edge: CropEdge, e: React.PointerEvent) => {
    if (!cropUi || !activeClip) return;
    e.preventDefault();
    e.stopPropagation();
    const clipId = activeClip.id;
    const before = project;
    const startX = e.clientX, startY = e.clientY;
    const startVal = activeClip[edge] ?? 0;
    const rad = (cropUi.rotation * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const { r, sx, sy } = cropUi;
    cropDragging.current = true;
    forceCropRender(n => n + 1);
    let moved = false;
    const move = (ev: PointerEvent) => {
      // screen delta → canvas px → clip-local axes (undo the rotation)
      const dxs = (ev.clientX - startX) / sx;
      const dys = (ev.clientY - startY) / sy;
      const dx = dxs * cos + dys * sin;
      const dy = -dxs * sin + dys * cos;
      const delta = edge === 'cropL' ? dx / r.w
        : edge === 'cropR' ? -dx / r.w
        : edge === 'cropT' ? dy / r.h
        : -dy / r.h;
      const next = Math.max(0, Math.min(0.45, startVal + delta));
      if (Math.abs(ev.clientX - startX) > 1 || Math.abs(ev.clientY - startY) > 1) moved = true;
      setProjectTransient(p => updateClipById(p, clipId, { [edge]: next }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cropDragging.current = false;
      forceCropRender(n => n + 1);
      if (moved) commitHistory(before);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const fillFrame = () => {
    if (!activeClip) return;
    commitHistory(project);
    onSelectClip(activeClip.id);
    setProjectTransient(p => updateClipById(p, activeClip.id, { fit: 'cover' }));
  };

  const dur = projectDuration(project);
  const selOverlay = project.overlays.find(o => o.id === selectedOverlayId) ?? null;
  const overlayVisible = selOverlay && playhead >= selOverlay.start && playhead < selOverlay.end;
  // Offer a one-tap "Fill frame" when a landscape clip is letterboxed in a
  // vertical/square project (the common repurpose-for-shorts case).
  const suggestFill = !playing && !!activeClip && (activeClip.fit ?? 'contain') === 'contain'
    && project.width <= project.height && !!activeVideo?.videoWidth
    && activeVideo.videoWidth / activeVideo.videoHeight > project.width / project.height + 0.01;

  return (
    <div className="relative flex-1 min-h-0 bg-black/60 flex items-center justify-center p-3">
      <canvas
        ref={canvasRef}
        width={project.width}
        height={project.height}
        onPointerDown={onCanvasPointerDown}
        className={`max-w-full max-h-full object-contain rounded-md shadow-lg bg-black ${
          reframing ? 'cursor-grabbing' : canReframe ? 'cursor-grab' : ''
        }`}
        style={{ aspectRatio: `${project.width} / ${project.height}` }}
      />

      {suggestFill && (
        <button
          onClick={fillFrame}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
          title="Crop this clip to fill the vertical frame"
        >
          <Maximize2 className="h-3.5 w-3.5" /> Fill frame
        </button>
      )}

      {overlayVisible && selOverlay && rect && (() => {
        // Selection frame sized to the drawn block (at its sampled position)
        // so the whole overlay is a drag surface, not just a center handle.
        const s = sampledFor(selOverlay);
        if (!s) return null;
        const sx = rect.width / project.width;
        const sy = rect.height / project.height;
        return (
          <div
            onPointerDown={e => startOverlayDrag(selOverlay, e)}
            className="absolute z-10 cursor-move rounded border border-dashed border-primary hover:bg-primary/10 transition-colors"
            style={{
              left: rect.left + (s.b.bx + s.dx) * sx,
              top: rect.top + (s.b.by + s.dy) * sy,
              width: Math.max(40, s.b.bw * sx),
              height: Math.max(24, s.b.bh * sy),
            }}
            title="Drag to position"
          >
            <span className="absolute -top-2.5 -right-2.5 rounded-full bg-primary p-1 shadow">
              <Move className="h-3 w-3 text-primary-foreground" />
            </span>
          </div>
        );
      })()}

      {cropUi && rect && (
        <div
          className="absolute z-10 pointer-events-none"
          style={{
            left: rect.left, top: rect.top, width: rect.width, height: rect.height,
            transform: cropUi.rotation ? `rotate(${cropUi.rotation}deg)` : undefined,
          }}
        >
          <div
            className={`absolute border border-dashed ${cropDragging.current ? 'border-primary' : 'border-primary/70'}`}
            style={{ left: cropUi.left, top: cropUi.top, width: cropUi.width, height: cropUi.height }}
          />
          {([
            ['cropL', { left: cropUi.left - 5, top: cropUi.top, width: 10, height: cropUi.height }, 'cursor-ew-resize', 'h-6 w-1'],
            ['cropR', { left: cropUi.left + cropUi.width - 5, top: cropUi.top, width: 10, height: cropUi.height }, 'cursor-ew-resize', 'h-6 w-1'],
            ['cropT', { left: cropUi.left, top: cropUi.top - 5, width: cropUi.width, height: 10 }, 'cursor-ns-resize', 'h-1 w-6'],
            ['cropB', { left: cropUi.left, top: cropUi.top + cropUi.height - 5, width: cropUi.width, height: 10 }, 'cursor-ns-resize', 'h-1 w-6'],
          ] as const).map(([edge, style, cursor, grip]) => (
            <div
              key={edge}
              onPointerDown={e => startCropDrag(edge, e)}
              className={`absolute pointer-events-auto ${cursor} group`}
              style={style}
              title="Drag to crop this edge"
            >
              <span className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow group-hover:scale-125 transition-transform ${grip}`} />
            </div>
          ))}
        </div>
      )}

      {dur === 0 && (
        <div className="absolute text-sm text-muted-foreground pointer-events-none">
          Add a clip from the media bin to begin
        </div>
      )}
    </div>
  );
}
