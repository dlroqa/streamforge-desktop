import {
  type EditorProject, projectDuration, clipsAtTime, sourceTimeFor,
  clipLength, fadeMultiplier, audioClipsAtTime, audioClipLength, clipSourceId,
} from '@/lib/editorProject';
import { renderFrame } from '@/lib/editorRender';

export interface ExportOptions {
  onProgress?: (fraction: number) => void;
  fps?: number;
  signal?: AbortSignal;
}

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/webm';
}

function bitrateFor(height: number): number {
  return height >= 2000 ? 25_000_000 : height >= 1000 ? 8_000_000 : 5_000_000;
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.src = src;
    v.muted = false;
    v.playsInline = true;
    v.preload = 'auto';
    const done = () => resolve(v);
    v.onloadeddata = done;
    v.onerror = done;
  });
}

/**
 * Render the whole timeline (clips, trims, overlays, per-clip audio) to a WebM
 * blob using MediaRecorder over a canvas + WebAudio mix. Captures in real time,
 * so it takes roughly as long as the timeline duration.
 */
export async function exportProjectWebm(
  project: EditorProject,
  resolve: (recordingId: string) => Promise<string | null>,
  resolveAudio: (assetId: string) => Promise<string | null>,
  opts: ExportOptions = {},
): Promise<Blob> {
  const fps = opts.fps ?? 30;
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('Nothing to export — add a clip to the timeline first.');

  // 1. Resolve each unique SOURCE (stabilized copy when enabled; the resolver
  // understands the `stab:` prefix) to a same-origin blob URL once, so the
  // canvas stays readable and shared sources aren't downloaded twice.
  const srcIds = [...new Set(project.clips.map(clipSourceId))];
  const revokable: string[] = [];
  const urls = new Map<string, string>();
  for (const id of srcIds) {
    const src = await resolve(id);
    if (!src) throw new Error('A clip could not be loaded for export.');
    if (src.startsWith('blob:')) {
      urls.set(id, src);
    } else {
      const res = await fetch(src);
      if (!res.ok) throw new Error('Could not download a clip for export (network/CORS).');
      const url = URL.createObjectURL(await res.blob());
      revokable.push(url);
      urls.set(id, url);
    }
  }

  // 2. Load one <video> PER CLIP (keyed by clip id) so overlapping layers play
  // independently; several clips of one source share its blob URL.
  const videos = new Map<string, HTMLVideoElement>();
  await Promise.all(project.clips.map(async c => {
    videos.set(c.id, await loadVideo(urls.get(clipSourceId(c))!));
  }));

  const images = new Map<string, HTMLImageElement>();
  await Promise.all(
    project.overlays.filter(o => o.type === 'image' && o.src).map(o => new Promise<void>(res => {
      const img = new Image();
      img.onload = () => res();
      img.onerror = () => res();
      img.src = o.src!;
      images.set(o.src!, img);
    })),
  );

  // 3. Canvas + audio graph
  const canvas = document.createElement('canvas');
  canvas.width = project.width;
  canvas.height = project.height;
  const ctx = canvas.getContext('2d')!;

  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  // One gain per clip element (createMediaElementSource is once-per-element,
  // and each clip has its own element, so this is safe).
  const gains = new Map<string, GainNode>();
  for (const c of project.clips) {
    try {
      const node = audioCtx.createMediaElementSource(videos.get(c.id)!);
      const gain = audioCtx.createGain();
      node.connect(gain);
      gain.connect(dest);
      gains.set(c.id, gain);
    } catch { /* clip has no audio track */ }
  }

  // Music / voiceover audio elements → gain → dest
  const audioEls = new Map<string, HTMLAudioElement>();
  const audioGains = new Map<string, GainNode>();
  await Promise.all((project.audioClips ?? []).map(async a => {
    const url = await resolveAudio(a.assetId);
    if (!url) return;
    const el = document.createElement('audio');
    el.src = url;
    await new Promise<void>(res => { el.onloadeddata = () => res(); el.onerror = () => res(); });
    audioEls.set(a.id, el);
    try {
      const node = audioCtx.createMediaElementSource(el);
      const gain = audioCtx.createGain();
      gain.gain.value = 0;
      node.connect(gain);
      gain.connect(dest);
      audioGains.set(a.id, gain);
    } catch { /* noop */ }
  }));

  if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {});

  const stream = new MediaStream([
    ...canvas.captureStream(fps).getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType = pickMime();
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrateFor(project.height) });
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  // 4. Real-time playback + capture
  return await new Promise<Blob>((resolve2, reject2) => {
    let raf = 0;
    let startClock = 0;
    let stopped = false;
    let cancelled = false;
    let activeIds = new Set<string>();

    const cleanup = () => {
      cancelAnimationFrame(raf);
      revokable.forEach(u => URL.revokeObjectURL(u));
      audioCtx.close().catch(() => {});
      for (const v of videos.values()) { v.pause(); v.src = ''; }
      for (const el of audioEls.values()) { el.pause(); el.src = ''; }
    };

    recorder.onstop = () => {
      cleanup();
      if (cancelled) reject2(new Error('Export cancelled'));
      else resolve2(new Blob(chunks, { type: mimeType }));
    };
    recorder.onerror = () => { cleanup(); reject2(new Error('Recording failed during export.')); };

    opts.signal?.addEventListener('abort', () => {
      if (stopped) return;
      cancelled = true; stopped = true;
      try { recorder.stop(); } catch { /* already stopping */ }
    });

    const tick = () => {
      if (stopped) return;
      const now = performance.now();
      if (!startClock) startClock = now;
      const t = (now - startClock) / 1000;

      if (t >= duration) {
        renderFrame(ctx, project, Math.max(0, duration - 0.001), videos, images);
        stopped = true;
        setTimeout(() => { try { recorder.stop(); } catch { /* noop */ } }, 120);
        return;
      }

      // All video layers active now — play + mix each; the renderer composites
      // them bottom-to-top. (Upper-layer clips are muted → gain 0 by default.)
      const active = clipsAtTime(project, t);
      const nextIds = new Set(active.map(c => c.id));
      // Pause + silence any clip that just left the active set.
      for (const id of activeIds) {
        if (!nextIds.has(id)) { videos.get(id)?.pause(); const g = gains.get(id); if (g) g.gain.value = 0; }
      }
      for (const clip of active) {
        const v = videos.get(clip.id)!;
        const gain = gains.get(clip.id);
        const vf = fadeMultiplier(t - clip.timelineStart, clipLength(clip), clip.fadeIn || 0, clip.fadeOut || 0);
        if (gain) gain.gain.value = clip.muted ? 0 : clip.volume * vf;
        v.playbackRate = clip.speed || 1;
        if (!activeIds.has(clip.id)) {
          v.currentTime = sourceTimeFor(clip, t);
          v.play().catch(() => {});
        } else {
          const want = sourceTimeFor(clip, t);
          if (Math.abs(v.currentTime - want) > 0.25) v.currentTime = want;
        }
      }
      activeIds = nextIds;

      // Music / voiceover track
      const activeAudio = new Set<string>();
      for (const a of audioClipsAtTime(project, t)) {
        activeAudio.add(a.id);
        const el = audioEls.get(a.id);
        const gain = audioGains.get(a.id);
        if (el) {
          const want = a.inPoint + (t - a.timelineStart);
          if (el.paused) { el.currentTime = want; el.play().catch(() => {}); }
          else if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
          const af = fadeMultiplier(t - a.timelineStart, audioClipLength(a), a.fadeIn || 0, a.fadeOut || 0);
          if (gain) gain.gain.value = a.muted ? 0 : a.volume * af;
        }
      }
      for (const [id, el] of audioEls) {
        if (!activeAudio.has(id)) {
          if (!el.paused) el.pause();
          const g = audioGains.get(id);
          if (g) g.gain.value = 0;
        }
      }

      renderFrame(ctx, project, t, videos, images);
      opts.onProgress?.(Math.min(1, t / duration));
      raf = requestAnimationFrame(tick);
    };

    recorder.start(100);
    raf = requestAnimationFrame(tick);
  });
}
