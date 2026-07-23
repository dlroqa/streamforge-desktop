import {
  type EditorProject, type EditorOverlay, type EditorClip,
  clipsAtTime, clipLength, sourceTimeFor, overlaysAtTime, fadeMultiplier, blendOpFor,
} from '@/lib/editorProject';
import { sampleOverlayMotion, type OverlayBounds } from '@/lib/overlayAnimation';
import { drawLowerThirdBlock, lowerThirdRect, DEFAULT_LOWER_THIRD_BLOCK_STYLE } from '@/lib/lowerThird';

// Shared frame renderer used by BOTH the live preview and the WebM exporter so
// what you see is exactly what gets rendered out.

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  project: EditorProject,
  t: number,
  videos: Map<string, HTMLVideoElement>,
  images: Map<string, HTMLImageElement>,
) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // Composite every active video clip bottom-to-top (base track first, upper
  // layers over it). Video elements are keyed by clip id so overlapping layers
  // never share one <video>.
  for (const clip of clipsAtTime(project, t)) {
    drawClipLayer(ctx, clip, t, W, H, videos.get(clip.id));
  }

  for (const o of overlaysAtTime(project, t)) {
    drawOverlay(ctx, o, W, H, images, t - o.start, o.end - o.start);
  }
}

/** Draw one video clip as a layer with its Video Inspector transform
 *  (blend + opacity, rotation, crop, reframe) and fade. Fade reduces the
 *  layer's alpha (fade to transparent) so it reveals the layer beneath rather
 *  than painting black over lower layers. */
function drawClipLayer(
  ctx: CanvasRenderingContext2D, clip: EditorClip, t: number,
  W: number, H: number, v: HTMLVideoElement | undefined,
) {
  if (!v || v.readyState < 2 || !v.videoWidth) return;
  const fm = fadeMultiplier(t - clip.timelineStart, clipLength(clip), clip.fadeIn || 0, clip.fadeOut || 0);
  const alpha = Math.max(0, clip.opacity ?? 1) * fm;
  if (alpha <= 0) return;

  ctx.save();
  if (alpha < 1) ctx.globalAlpha *= alpha;
  const blend = blendOpFor(clip.blendMode);
  if (blend !== 'source-over') ctx.globalCompositeOperation = blend;
  // Rotation is set up before the crop clip path so the crop trims the clip's
  // actual edges and turns with it, instead of staying frame-aligned.
  if (clip.rotation) {
    ctx.translate(W / 2, H / 2);
    ctx.rotate((clip.rotation * Math.PI) / 180);
    ctx.translate(-W / 2, -H / 2);
  }
  const { x, y, w, h } = reframeRect(
    W, H, v.videoWidth, v.videoHeight,
    clip.fit ?? 'contain', clip.zoom ?? 1, clip.panX ?? 0.5, clip.panY ?? 0.5,
  );
  // Crop: each inset is a fraction of the video's drawn rect, so the sliders
  // trim the visible video edges directly.
  const cl = (clip.cropL ?? 0) * w;
  const ct = (clip.cropT ?? 0) * h;
  const cr = (clip.cropR ?? 0) * w;
  const cb = (clip.cropB ?? 0) * h;
  if (cl || ct || cr || cb) {
    ctx.beginPath();
    ctx.rect(x + cl, y + ct, Math.max(0, w - cl - cr), Math.max(0, h - ct - cb));
    ctx.clip();
  }
  ctx.drawImage(v, x, y, w, h);
  ctx.restore();
}

/** Seek every active clip's source video to its frame for time `t` (paused
 *  preview / scrub). */
export function seekVideosTo(project: EditorProject, t: number, videos: Map<string, HTMLVideoElement>) {
  for (const clip of clipsAtTime(project, t)) {
    const v = videos.get(clip.id);
    // Let an in-flight seek land before retargeting: recordings are
    // MediaRecorder WebMs with no seek index, so seeks are slow, and every
    // currentTime write aborts the previous one. Scrubbing still converges —
    // after the seek lands, the next frame's drift check issues the final one.
    if (v && v.readyState >= 1 && !v.seeking) {
      const want = sourceTimeFor(clip, t);
      if (Math.abs(v.currentTime - want) > 0.03) {
        v.currentTime = Math.min(Math.max(want, 0), v.duration || want);
      }
    }
  }
}

/** Compute the destination rect for a source drawn into the frame with the
 *  clip's reframe transform (fit + zoom + pan). Shared by the renderer and the
 *  preview's drag-to-reframe so the math stays in one place. */
export function reframeRect(
  cw: number, ch: number, sw: number, sh: number,
  fit: 'contain' | 'cover', zoom: number, panX: number, panY: number,
) {
  const base = fit === 'cover' ? Math.max(cw / sw, ch / sh) : Math.min(cw / sw, ch / sh);
  const scale = base * Math.max(1, zoom || 1);
  const w = sw * scale;
  const h = sh * scale;
  // (cw - w) is the free space (negative when the source overflows the frame).
  const x = (cw - w) * (panX ?? 0.5);
  const y = (ch - h) * (panY ?? 0.5);
  return { x, y, w, h, overflowX: w - cw, overflowY: h - ch };
}

/** Approximate drawn bounds of an overlay at its base position, in canvas px.
 *  Feeds slide offscreen distances, wipe clip rects, and the preview's
 *  drag-to-position hit surface. */
export function overlayBounds(
  ctx: CanvasRenderingContext2D, o: EditorOverlay,
  W: number, H: number, images: Map<string, HTMLImageElement>,
): OverlayBounds {
  const cx = o.x * W;
  const cy = o.y * H;
  if (o.type === 'lowerThird') {
    const { bx, by, bw, bh } = lowerThirdRect(
      o.ltStyle ?? DEFAULT_LOWER_THIRD_BLOCK_STYLE, !!o.subtitle, cx, cy, W, H,
    );
    return { bx, by, bw, bh };
  }
  if (o.type === 'image') {
    const img = o.src ? images.get(o.src) : undefined;
    const bw = (o.width ?? 0.3) * W;
    const bh = img?.naturalWidth ? bw * (img.naturalHeight / img.naturalWidth) : bw * 0.5625;
    return { bx: cx - bw / 2, by: cy - bh / 2, bw, bh };
  }
  // Text: same box math as the background pill in the draw below
  const size = o.fontSize ?? 64;
  ctx.save();
  ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  const bw = ctx.measureText(o.text ?? '').width + size * 0.6;
  ctx.restore();
  const bh = size * 1.5;
  return { bx: cx - bw / 2, by: cy - bh / 2, bw, bh };
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D, o: EditorOverlay,
  W: number, H: number, images: Map<string, HTMLImageElement>,
  localTime: number, length: number,
) {
  const bounds = overlayBounds(ctx, o, W, H, images);
  const m = sampleOverlayMotion(
    { x: o.x, y: o.y, scale: o.scale, opacity: o.opacity },
    o.animation, localTime, length, W, H, bounds,
  );
  if (m.opacity <= 0 || m.scale <= 0 || m.wipe <= 0) return;

  ctx.save();
  ctx.globalAlpha *= m.opacity;
  // Motion offsets apply as a ctx translation AFTER the content's own layout
  // (incl. the lower third's clamp-to-frame), so slides really go offscreen.
  const dx = (m.x - o.x) * W;
  const dy = (m.y - o.y) * H;
  if (dx || dy) ctx.translate(dx, dy);
  const cx = o.x * W;
  const cy = o.y * H;
  if (m.rotation || m.scale !== 1) {
    ctx.translate(cx, cy);
    if (m.rotation) ctx.rotate(m.rotation);
    if (m.scale !== 1) ctx.scale(m.scale, m.scale);
    ctx.translate(-cx, -cy);
  }
  if (m.wipe < 1 && m.wipeAnchor) {
    const w = bounds.bw * m.wipe;
    const x = m.wipeAnchor === 'left' ? bounds.bx : bounds.bx + bounds.bw - w;
    ctx.beginPath();
    ctx.rect(x, bounds.by, w, bounds.bh);
    ctx.clip();
  }
  drawOverlayContent(ctx, o, cx, cy, W, H, images);
  ctx.restore();
}

function drawOverlayContent(
  ctx: CanvasRenderingContext2D, o: EditorOverlay,
  cx: number, cy: number, W: number, H: number, images: Map<string, HTMLImageElement>,
) {
  if (o.type === 'lowerThird') {
    drawLowerThirdBlock(
      ctx,
      { title: o.title ?? '', subtitle: o.subtitle ?? '', style: o.ltStyle ?? DEFAULT_LOWER_THIRD_BLOCK_STYLE },
      cx, cy, W, H,
    );
  } else if (o.type === 'text') {
    const size = o.fontSize ?? 64;
    ctx.save();
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = o.text ?? '';
    if (o.bgColor) {
      const w = ctx.measureText(text).width + size * 0.6;
      const h = size * 1.5;
      ctx.fillStyle = o.bgColor;
      roundRect(ctx, cx - w / 2, cy - h / 2, w, h, size * 0.2);
      ctx.fill();
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = size * 0.15;
      ctx.shadowOffsetY = size * 0.03;
    }
    ctx.fillStyle = o.color ?? '#ffffff';
    ctx.fillText(text, cx, cy);
    ctx.restore();
  } else if (o.type === 'image' && o.src) {
    const img = images.get(o.src);
    if (img && img.complete && img.naturalWidth) {
      const w = (o.width ?? 0.3) * W;
      const h = w * (img.naturalHeight / img.naturalWidth);
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
