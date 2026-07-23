// Shared lower-third model + canvas drawing, used by BOTH the live broadcast
// compositor (streamCompositor.ts) and the video editor renderer
// (editorRender.ts). This is a leaf module — no React, no pipeline imports —
// so neither surface couples to the other.

export type LowerThirdShape = 'none' | 'rounded' | 'pill';

export const LOWER_THIRD_FONTS = [
  { id: 'inter', label: 'Inter (Modern)', stack: "Inter, system-ui, sans-serif" },
  { id: 'serif', label: 'Georgia (Serif)', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'mono', label: 'JetBrains Mono', stack: "'JetBrains Mono', monospace" },
  { id: 'display', label: 'Impact (Display)', stack: "Impact, 'Arial Black', sans-serif" },
  { id: 'humanist', label: 'Trebuchet (Humanist)', stack: "'Trebuchet MS', Verdana, sans-serif" },
] as const;

export type LowerThirdFontId = typeof LOWER_THIRD_FONTS[number]['id'];

export type LowerThirdAlign = 'left' | 'center' | 'right';

/** Visual style of the block itself, position-agnostic. The studio adds x/y
 * on top (LowerThirdStyle); the editor keeps position on the overlay. */
export interface LowerThirdBlockStyle {
  bgColor: string;
  textColor: string;
  accentColor: string;
  /** Title/subtitle sizes in broadcast design px (720p coordinate space) */
  titleSize: number;
  subtitleSize: number;
  font: LowerThirdFontId;
  shape: LowerThirdShape;
  align: LowerThirdAlign;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface LowerThirdStyle extends LowerThirdBlockStyle {
  /** Block center position as canvas fractions (draggable/slider-set) */
  x: number;
  y: number;
}

export const DEFAULT_LOWER_THIRD_BLOCK_STYLE: LowerThirdBlockStyle = {
  bgColor: '#06b4e0',
  textColor: '#ffffff',
  accentColor: '#f99e1f',
  titleSize: 28,
  subtitleSize: 19,
  font: 'inter',
  shape: 'none',
  align: 'left',
  bold: true,
  italic: false,
  underline: false,
};

export const DEFAULT_LOWER_THIRD_STYLE: LowerThirdStyle = {
  ...DEFAULT_LOWER_THIRD_BLOCK_STYLE,
  x: 0.5,
  y: 0.88,
};

export function lowerThirdFontStack(id: LowerThirdFontId): string {
  return LOWER_THIRD_FONTS.find(f => f.id === id)?.stack ?? LOWER_THIRD_FONTS[0].stack;
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

/** The rect the block occupies for a given center, in canvas px. Style sizes
 * live in 720p design space; everything scales by frameH / 720 so the same
 * style renders identically on 720p broadcast and 1080p/vertical editor
 * frames. Width is capped to the frame so vertical projects don't overflow. */
export function lowerThirdRect(
  style: LowerThirdBlockStyle, hasSubtitle: boolean,
  centerX: number, centerY: number, frameW: number, frameH: number,
): { bx: number; by: number; bw: number; bh: number; s: number } {
  const s = frameH / 720;
  const padY = 18 * s;
  const gap = hasSubtitle ? 10 * s : 0;
  const bh = padY * 2 + style.titleSize * s + (hasSubtitle ? gap + style.subtitleSize * s : 0);
  const bw = Math.min(640 * s, frameW - 16 * s);
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const bx = clamp(centerX - bw / 2, 8 * s, frameW - bw - 8 * s);
  const by = clamp(centerY - bh / 2, 8 * s, frameH - bh - 8 * s);
  return { bx, by, bw, bh, s };
}

/** Draw a lower-third block centered at (centerX, centerY) in canvas px.
 * Pure: no class state, no side effects beyond the ctx. */
export function drawLowerThirdBlock(
  ctx: CanvasRenderingContext2D,
  input: { title: string; subtitle: string; style: LowerThirdBlockStyle },
  centerX: number, centerY: number, frameW: number, frameH: number,
) {
  const { title, subtitle, style } = input;
  const fontStack = lowerThirdFontStack(style.font);
  const textOnly = style.shape !== 'rounded' && style.shape !== 'pill';
  const { bx, by, bw, bh, s } = lowerThirdRect(style, !!subtitle, centerX, centerY, frameW, frameH);

  // Layout driven by text sizes
  const padX = (style.shape === 'pill' ? 40 : 28) * s;
  const padY = 18 * s;
  const gap = subtitle ? 10 * s : 0;
  const titleSize = style.titleSize * s;
  const subtitleSize = style.subtitleSize * s;
  const align = style.align ?? 'left';

  if (!textOnly) {
    // Background shape + accent bar along the BOTTOM edge
    const radius = style.shape === 'pill' ? bh / 2 : 14 * s;
    ctx.save();
    ctx.fillStyle = hexToRgba(style.bgColor, 0.95);
    roundRectPath(ctx, bx, by, bw, bh, radius);
    ctx.fill();
    roundRectPath(ctx, bx, by, bw, bh, radius);
    ctx.clip();
    ctx.fillStyle = style.accentColor;
    ctx.fillRect(bx, by + bh - 6 * s, bw, 6 * s);
    ctx.restore();
  }

  // Text (with a drop shadow in text-only mode so it pops off the video).
  const maxW = bw - padX * 2;
  const textX = align === 'center'
    ? bx + bw / 2
    : align === 'right'
      ? bx + bw - padX
      : bx + padX;
  const weightTitle = style.bold ? 700 : 400;
  const weightSub = style.bold ? 600 : 400;
  const italic = style.italic ? 'italic ' : '';

  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (textOnly) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 10 * s;
    ctx.shadowOffsetY = 2 * s;
  }

  const drawLine = (text: string, size: number, weight: number, color: string, baselineY: number) => {
    ctx.fillStyle = color;
    ctx.font = `${italic}${weight} ${size}px ${fontStack}`;
    const rendered = truncate(ctx, text, maxW);
    ctx.fillText(rendered, textX, baselineY);
    if (style.underline) {
      const width = ctx.measureText(rendered).width;
      const ux = align === 'center' ? textX - width / 2 : align === 'right' ? textX - width : textX;
      ctx.fillRect(ux, baselineY + size * 0.12, width, Math.max(1.5, size / 16));
    }
  };

  drawLine(title, titleSize, weightTitle, style.textColor, by + padY + titleSize * 0.82);
  if (subtitle) {
    drawLine(
      subtitle, subtitleSize, weightSub,
      hexToRgba(style.textColor, 0.75),
      by + padY + titleSize + gap + subtitleSize * 0.82,
    );
  }
  ctx.restore();
}
