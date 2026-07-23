/**
 * Slideshow presenter. Renders an uploaded deck (PDF, or a single image) to a
 * fixed 16:9 canvas and exposes it as a MediaStream via captureStream(), so it
 * rides the studio's existing screen-share channel — main source, cameras as
 * PiP, LUT/filters, broadcast and recording all work unchanged.
 *
 * PowerPoint/Keynote/Google Slides don't run natively in a browser, but every
 * one of them exports to PDF, which we render faithfully with PDF.js.
 */

const OUT_W = 1920;
const OUT_H = 1080;
const CAPTURE_FPS = 12; // slides are static; low fps keeps the encoder happy

export interface SlideshowMeta {
  title: string;
  total: number;
  current: number; // 1-based
}

/** Deck identity used for titles and for keying resume-position maps, so a deck
 *  re-presented after being stopped can be matched back to where it left off. */
export function deckTitleFromName(name: string): string {
  return name.replace(/\.(pdf|png|jpe?g|webp|gif)$/i, '');
}

export class SlideshowController {
  readonly stream: MediaStream;
  readonly title: string;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private disposed = false;

  private total = 0;
  private current = 1;
  private cache = new Map<number, HTMLCanvasElement>();
  private renderPage: ((n: number) => Promise<HTMLCanvasElement>) | null = null;
  private onChange?: (meta: SlideshowMeta) => void;

  private constructor(title: string) {
    this.title = title;
    this.canvas = document.createElement('canvas');
    this.canvas.width = OUT_W;
    this.canvas.height = OUT_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable for the slideshow');
    this.ctx = ctx;
    this.paintBlank();
    if (typeof this.canvas.captureStream !== 'function') {
      throw new Error('This browser can’t capture the slideshow canvas — try Chrome');
    }
    this.stream = this.canvas.captureStream(CAPTURE_FPS);
    // Keep the capture surface painted so the encoder always has live frames
    const loop = () => {
      if (this.disposed) return;
      this.blitCurrent();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Load a deck. Rejects with a readable message on unsupported/corrupt files.
   *  `startPage` resumes an earlier position (clamped); defaults to slide 1. */
  static async load(
    file: File,
    onChange?: (meta: SlideshowMeta) => void,
    startPage = 1,
  ): Promise<SlideshowController> {
    const title = deckTitleFromName(file.name);
    const ctrl = new SlideshowController(title);
    ctrl.onChange = onChange;

    if (file.type.startsWith('image/')) {
      const bitmap = await createImageBitmap(file);
      const slide = document.createElement('canvas');
      slide.width = bitmap.width;
      slide.height = bitmap.height;
      slide.getContext('2d')!.drawImage(bitmap, 0, 0);
      bitmap.close();
      ctrl.cache.set(1, slide);
      ctrl.total = 1;
    } else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const pdfjs = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjs.getDocument({ data }).promise;
      ctrl.total = pdf.numPages;
      ctrl.renderPage = async (n: number) => {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        // Render at output resolution for crisp text, capped for huge pages
        const scale = Math.min(OUT_W / base.width, OUT_H / base.height, 4);
        const viewport = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = Math.ceil(viewport.width);
        c.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: c.getContext('2d')!, viewport }).promise;
        return c;
      };
    } else if (/\.(pptx?|pps|ppsx|key|odp)$/i.test(file.name)) {
      // No browser can render PowerPoint/Keynote natively, and every
      // client-side .pptx renderer we evaluated misparses real decks — too
      // unreliable to put on a live broadcast. Point at the exact, lossless fix.
      ctrl.dispose();
      throw new Error(
        'PowerPoint files can’t be presented directly. In PowerPoint choose File → Export (or Save As) → PDF, then upload that PDF — it presents with exact fidelity. Keynote and Google Slides export to PDF the same way.',
      );
    } else {
      ctrl.dispose();
      throw new Error('Unsupported file — upload a PDF (export from PowerPoint/Keynote/Slides) or an image');
    }

    if (ctrl.total < 1) {
      ctrl.dispose();
      throw new Error('That file has no slides');
    }
    await ctrl.show(startPage); // show() clamps to [1, total]
    return ctrl;
  }

  get meta(): SlideshowMeta {
    return { title: this.title, total: this.total, current: this.current };
  }

  next() { void this.show(this.current + 1); }
  prev() { void this.show(this.current - 1); }
  goTo(n: number) { void this.show(n); }

  private async ensureSlide(n: number): Promise<HTMLCanvasElement | null> {
    const cached = this.cache.get(n);
    if (cached) return cached;
    if (!this.renderPage) return null;
    const rendered = await this.renderPage(n);
    if (this.disposed) return null;
    this.cache.set(n, rendered);
    // Keep memory bounded for large decks: drop slides far from the cursor
    if (this.cache.size > 12) {
      for (const key of this.cache.keys()) {
        if (Math.abs(key - n) > 5) { this.cache.delete(key); break; }
      }
    }
    return rendered;
  }

  private async show(n: number) {
    const target = Math.max(1, Math.min(this.total, n));
    this.current = target;
    this.onChange?.(this.meta);
    const slide = await this.ensureSlide(target);
    if (this.disposed || this.current !== target) return;
    if (slide) {
      this.currentSlide = slide;
      this.blitCurrent();
    }
    // Warm the neighbors so navigation feels instant
    void this.ensureSlide(target + 1);
    void this.ensureSlide(target - 1);
  }

  private currentSlide: HTMLCanvasElement | null = null;

  private paintBlank() {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, OUT_W, OUT_H);
  }

  /** Draw the current slide contained (letterboxed) on a black 16:9 field. */
  private blitCurrent() {
    const slide = this.currentSlide;
    this.paintBlank();
    if (!slide) return;
    const scale = Math.min(OUT_W / slide.width, OUT_H / slide.height);
    const w = slide.width * scale;
    const h = slide.height * scale;
    this.ctx.drawImage(slide, (OUT_W - w) / 2, (OUT_H - h) / 2, w, h);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.stream.getTracks().forEach(t => t.stop());
    this.cache.clear();
    this.currentSlide = null;
  }
}
