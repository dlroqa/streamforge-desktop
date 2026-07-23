import { describe, it, expect } from 'vitest';
import {
  sampleOverlayMotion, EASINGS, type OverlayAnimation, type OverlayBounds,
} from '@/lib/overlayAnimation';
import {
  createEmptyProject, makeLowerThirdOverlay, makeTextOverlay, addOverlay,
  splitOverlay, normalizeProject, type EditorProject,
} from '@/lib/editorProject';

const FRAME = { W: 1920, H: 1080 };
const BOUNDS: OverlayBounds = { bx: 480, by: 850, bw: 960, bh: 100 };
const BASE = { x: 0.5, y: 0.85 };

const sample = (anim: OverlayAnimation | undefined, t: number, len = 5) =>
  sampleOverlayMotion(BASE, anim, t, len, FRAME.W, FRAME.H, BOUNDS);

describe('sampleOverlayMotion — identity', () => {
  it('returns base props untouched when animation is undefined (old projects)', () => {
    const m = sample(undefined, 1.0);
    expect(m).toEqual({ x: 0.5, y: 0.85, scale: 1, opacity: 1, rotation: 0, wipe: 1, wipeAnchor: null });
  });

  it('is at rest between the in and out windows', () => {
    const anim: OverlayAnimation = {
      in: { preset: 'slide-left', duration: 0.5, easing: 'linear' },
      out: { preset: 'fade', duration: 0.5, easing: 'linear' },
    };
    const m = sample(anim, 2.5);
    expect(m.x).toBeCloseTo(0.5);
    expect(m.opacity).toBe(1);
  });
});

describe('in/out preset envelopes', () => {
  it('fade in ramps opacity 0 → 1 across the window', () => {
    const anim: OverlayAnimation = { in: { preset: 'fade', duration: 1, easing: 'linear' } };
    expect(sample(anim, 0).opacity).toBe(0);
    expect(sample(anim, 0.5).opacity).toBeCloseTo(0.5);
    expect(sample(anim, 1.001).opacity).toBe(1);
  });

  it('fade out ramps opacity 1 → 0 at the end', () => {
    const anim: OverlayAnimation = { out: { preset: 'fade', duration: 1, easing: 'linear' } };
    expect(sample(anim, 3.999).opacity).toBe(1);
    expect(sample(anim, 4.5).opacity).toBeCloseTo(0.5);
    expect(sample(anim, 5).opacity).toBeCloseTo(0);
  });

  it('slide-left starts fully offscreen left and lands at the base position', () => {
    const anim: OverlayAnimation = { in: { preset: 'slide-left', duration: 1, easing: 'linear' } };
    const start = sample(anim, 0);
    // Block right edge (bx + bw = 1440px around the shifted center) must be < 0
    const shiftPx = (start.x - BASE.x) * FRAME.W;
    expect(shiftPx).toBeCloseTo(-(BOUNDS.bx + BOUNDS.bw));
    expect(sample(anim, 1.001).x).toBeCloseTo(BASE.x);
  });

  it('slide-up enters from below the bottom edge', () => {
    const anim: OverlayAnimation = { in: { preset: 'slide-up', duration: 1, easing: 'linear' } };
    const start = sample(anim, 0);
    expect((start.y - BASE.y) * FRAME.H).toBeCloseTo(FRAME.H - BOUNDS.by);
  });

  it('pop overshoots scale past 1 with easeOutBack', () => {
    const anim: OverlayAnimation = { in: { preset: 'pop', duration: 1, easing: 'easeOutBack' } };
    // easeOutBack peaks above 1 in the back stretch of the curve
    const scales = [0.7, 0.8, 0.9].map(t => sample(anim, t).scale);
    expect(Math.max(...scales)).toBeGreaterThan(1);
    expect(sample(anim, 1.001).scale).toBe(1);
  });

  it('wipe reveals from the left on in, hides to the right anchor on out', () => {
    const anim: OverlayAnimation = {
      in: { preset: 'wipe', duration: 1, easing: 'linear' },
      out: { preset: 'wipe', duration: 1, easing: 'linear' },
    };
    const mid = sample(anim, 0.5);
    expect(mid.wipe).toBeCloseTo(0.5);
    expect(mid.wipeAnchor).toBe('left');
    const out = sample(anim, 4.5);
    expect(out.wipe).toBeCloseTo(0.5);
    expect(out.wipeAnchor).toBe('right');
  });

  it('clamps in/out windows to half the overlay length so they never overlap', () => {
    const anim: OverlayAnimation = {
      in: { preset: 'fade', duration: 2, easing: 'linear' },
      out: { preset: 'fade', duration: 2, easing: 'linear' },
    };
    // 1s overlay: each window clamps to 0.5s
    const m = sample(anim, 0.5, 1);       // boundary: in just done, out just starting
    expect(m.opacity).toBeCloseTo(1);
    expect(sample(anim, 0.25, 1).opacity).toBeCloseTo(0.5); // in at half
    expect(sample(anim, 0.75, 1).opacity).toBeCloseTo(0.5); // out at half
  });
});

describe('keyframe interpolation (Phase B data path)', () => {
  it('lerps a channel between keyframes and holds outside them', () => {
    const anim: OverlayAnimation = {
      keyframes: [
        { t: 1, props: { opacity: 0 } },
        { t: 2, props: { opacity: 1 } },
      ],
    };
    expect(sample(anim, 0).opacity).toBe(0);      // hold before first
    expect(sample(anim, 1.5).opacity).toBeCloseTo(0.5);
    expect(sample(anim, 3).opacity).toBe(1);      // hold after last
  });

  it('applies the easing into the destination keyframe', () => {
    const anim: OverlayAnimation = {
      keyframes: [
        { t: 0, props: { x: 0 } },
        { t: 1, props: { x: 1 }, easing: 'easeOutCubic' },
      ],
    };
    expect(sample(anim, 0.5).x).toBeCloseTo(EASINGS.easeOutCubic(0.5));
  });

  it('leaves channels without keyframes at their base value', () => {
    const anim: OverlayAnimation = { keyframes: [{ t: 0, props: { scale: 2 } }] };
    const m = sample(anim, 0.5);
    expect(m.scale).toBe(2);
    expect(m.x).toBe(BASE.x);
    expect(m.y).toBe(BASE.y);
  });

  it('composes with preset envelopes (keyframes then in/out on top)', () => {
    const anim: OverlayAnimation = {
      in: { preset: 'fade', duration: 1, easing: 'linear' },
      keyframes: [{ t: 0, props: { opacity: 0.5 } }],
    };
    expect(sample(anim, 0.5).opacity).toBeCloseTo(0.25); // 0.5 (kf) × 0.5 (fade-in)
  });
});

describe('easings', () => {
  it('all easings hit 0 at t=0 and 1 at t=1', () => {
    for (const fn of Object.values(EASINGS)) {
      expect(fn(0)).toBeCloseTo(0);
      expect(fn(1)).toBeCloseTo(1);
    }
  });

  it('easeOutBack overshoots above 1', () => {
    const peak = Math.max(...Array.from({ length: 99 }, (_, i) => EASINGS.easeOutBack((i + 1) / 100)));
    expect(peak).toBeGreaterThan(1);
  });
});

describe('editorProject lower-third integration', () => {
  it('makeLowerThirdOverlay ships defaults with in/out motion', () => {
    const o = makeLowerThirdOverlay(2);
    expect(o.type).toBe('lowerThird');
    expect(o.start).toBe(2);
    expect(o.end).toBe(7);
    expect(o.ltStyle?.shape).toBe('rounded');
    expect(o.animation?.in?.preset).toBe('slide-left');
    expect(o.animation?.out?.preset).toBe('fade');
  });

  it('splitOverlay strips the out anim from the left half and the in anim from the right', () => {
    let p = createEmptyProject();
    const o = makeLowerThirdOverlay(0);
    p = addOverlay(p, o);
    p = splitOverlay(p, o.id, 2.5);
    expect(p.overlays).toHaveLength(2);
    const [left, right] = p.overlays;
    expect(left.animation?.in?.preset).toBe('slide-left');
    expect(left.animation?.out).toBeUndefined();
    expect(right.animation?.in).toBeUndefined();
    expect(right.animation?.out?.preset).toBe('fade');
  });

  it('splitOverlay keeps animation undefined for plain text overlays', () => {
    let p = createEmptyProject();
    const o = makeTextOverlay(0);
    p = addOverlay(p, o);
    p = splitOverlay(p, o.id, 2.5);
    expect(p.overlays[0].animation).toBeUndefined();
    expect(p.overlays[1].animation).toBeUndefined();
  });

  it('normalizeProject round-trips an old project without lower-third fields', () => {
    const old = JSON.parse(JSON.stringify({
      ...createEmptyProject(),
      overlays: [{ id: 'o1', type: 'text', start: 0, end: 5, x: 0.5, y: 0.85, text: 'hi', fontSize: 64, color: '#fff', bgColor: null }],
    })) as EditorProject;
    const p = normalizeProject(old);
    expect(p.version).toBe(1);
    expect(p.overlays[0].animation).toBeUndefined();
    expect(p.overlays[0].ltStyle).toBeUndefined();
    // And the sampler treats it as static
    const m = sampleOverlayMotion(
      { x: p.overlays[0].x, y: p.overlays[0].y }, p.overlays[0].animation,
      1, 5, FRAME.W, FRAME.H, BOUNDS,
    );
    expect(m.opacity).toBe(1);
    expect(m.x).toBe(0.5);
  });
});
