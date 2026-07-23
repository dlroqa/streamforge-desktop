/**
 * Export the current look (preset filter + color corrections) as a 3D .cube
 * LUT.
 *
 * Method: exact-by-construction. An identity color lattice (every LUT entry
 * as a pixel) is drawn through the SAME pipeline the broadcast uses — CSS
 * filter string, SVG gamma, multiply/add composite blends — and the result
 * is read back as the LUT table. No re-implemented color math to drift.
 *
 * Opacity is intentionally excluded (it's transparency, not a color mapping)
 * and an uploaded LUT is not chained in (export describes the corrections,
 * not the source LUT).
 */
import { FILTER_CSS, type ColorGrade } from '@/lib/streamCompositor';
import { LUT_RECIPE_MARK } from '@/lib/lut';
import type { VideoFilter } from '@/contexts/StudioContext';

const N = 33; // industry-standard cube size

export function generateCubeLut(
  filter: VideoFilter,
  grade: ColorGrade,
  title: string,
): string | null {
  const w = N * N;
  const h = N;

  // Identity lattice: pixel (x = b*N + r, y = g) holds color (r, g, b)
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sctx = src.getContext('2d');
  if (!sctx) return null;
  const img = sctx.createImageData(w, h);
  for (let b = 0; b < N; b++) {
    for (let g = 0; g < N; g++) {
      for (let r = 0; r < N; r++) {
        const i = ((g * w) + b * N + r) * 4;
        img.data[i] = Math.round((r * 255) / (N - 1));
        img.data[i + 1] = Math.round((g * 255) / (N - 1));
        img.data[i + 2] = Math.round((b * 255) / (N - 1));
        img.data[i + 3] = 255;
      }
    }
  }
  sctx.putImageData(img, 0, 0);

  try {
    const dst = document.createElement('canvas');
    dst.width = w;
    dst.height = h;
    const dctx = dst.getContext('2d', { willReadFrequently: true });
    if (!dctx) return null;

    // Same ordering as buildFilterCss, minus opacity. Gamma is deliberately
    // NOT in the filter string: canvas 2D silently paints nothing when
    // ctx.filter mixes CSS functions with an SVG url() reference — the very
    // bug that used to export all-black LUTs. It's applied as exact pixel
    // math below instead (same sRGB transfer as the preview's
    // feComponentTransfer: v ^ 1/gamma), which cannot fail.
    const parts: string[] = [];
    const presetCss = FILTER_CSS[filter];
    if (presetCss) parts.push(presetCss);
    if (grade.brightness !== 100) parts.push(`brightness(${grade.brightness}%)`);
    if (grade.contrast !== 100) parts.push(`contrast(${grade.contrast}%)`);
    if (grade.saturation !== 100) parts.push(`saturate(${grade.saturation}%)`);
    if (grade.hue !== 0) parts.push(`hue-rotate(${grade.hue}deg)`);

    dctx.filter = parts.join(' ') || 'none';
    dctx.drawImage(src, 0, 0);
    dctx.filter = 'none';

    if (grade.gamma !== 1) {
      const exponent = 1 / Math.max(0.1, grade.gamma);
      const curve = new Uint8Array(256);
      for (let v = 0; v < 256; v++) {
        curve[v] = Math.round(255 * Math.pow(v / 255, exponent));
      }
      const gimg = dctx.getImageData(0, 0, w, h);
      const gd = gimg.data;
      for (let i = 0; i < gd.length; i += 4) {
        gd[i] = curve[gd[i]];
        gd[i + 1] = curve[gd[i + 1]];
        gd[i + 2] = curve[gd[i + 2]];
      }
      dctx.putImageData(gimg, 0, 0);
    }
    if (grade.multiplyEnabled) {
      dctx.globalCompositeOperation = 'multiply';
      dctx.fillStyle = grade.multiplyColor;
      dctx.fillRect(0, 0, w, h);
    }
    if (grade.addEnabled) {
      dctx.globalCompositeOperation = 'lighter';
      dctx.fillStyle = grade.addColor;
      dctx.fillRect(0, 0, w, h);
    }
    dctx.globalCompositeOperation = 'source-over';

    const data = dctx.getImageData(0, 0, w, h).data;
    // The identity lattice spans the full color range, so an (almost) black
    // readback means a filter pass silently failed — refuse to export it
    let maxV = 0;
    for (let i = 0; i < data.length; i += 4) {
      maxV = Math.max(maxV, data[i], data[i + 1], data[i + 2]);
    }
    if (maxV < 8) return null;

    const fmt = (v: number) => (v / 255).toFixed(6);
    // Embed the crafting recipe as a spec-legal comment: other apps ignore
    // it, but re-uploading the file into StreamForge recovers the exact
    // filter + correction values the table was baked from.
    const lines = [
      `TITLE "${title}"`,
      `# ${LUT_RECIPE_MARK} ${JSON.stringify({ filter, grade })}`,
      `LUT_3D_SIZE ${N}`,
      '',
    ];
    for (let b = 0; b < N; b++) {
      for (let g = 0; g < N; g++) {
        for (let r = 0; r < N; r++) {
          const i = ((g * w) + b * N + r) * 4;
          lines.push(`${fmt(data[i])} ${fmt(data[i + 1])} ${fmt(data[i + 2])}`);
        }
      }
    }
    return lines.join('\n') + '\n';
  } catch {
    return null;
  }
}

export function downloadCubeLut(filter: VideoFilter, grade: ColorGrade, name: string): boolean {
  const text = generateCubeLut(filter, grade, name);
  if (!text) return false;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'streamforge-look'}.cube`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
