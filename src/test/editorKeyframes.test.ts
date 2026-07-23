import { describe, it, expect } from 'vitest';
import {
  upsertKeyframe, removeKeyframe, findKeyframeIndexAt, setKeyframeEasing,
  shiftKeyframes, sampleOverlayMotion, sampleKeyframeProps,
  type OverlayAnimation, type AnimatableProps,
} from '@/lib/overlayAnimation';
import {
  createEmptyProject, makeLowerThirdOverlay, addOverlay, updateOverlayById,
  splitOverlay, retimeOverlayKeyframe,
} from '@/lib/editorProject';

const BOUNDS = { bx: 480, by: 850, bw: 960, bh: 100 };

describe('keyframe editing helpers', () => {
  it('upsert inserts a new keyframe with default easing', () => {
    const anim = upsertKeyframe(undefined, 1.5, { x: 0.3 });
    expect(anim.keyframes).toHaveLength(1);
    expect(anim.keyframes![0]).toMatchObject({ t: 1.5, props: { x: 0.3 }, easing: 'easeInOutCubic' });
  });

  it('upsert merges props into a keyframe within one frame (epsilon)', () => {
    let anim = upsertKeyframe(undefined, 1.5, { x: 0.3 });
    anim = upsertKeyframe(anim, 1.52, { y: 0.8 }); // within 1/30s
    expect(anim.keyframes).toHaveLength(1);
    expect(anim.keyframes![0].props).toEqual({ x: 0.3, y: 0.8 });
    expect(anim.keyframes![0].t).toBe(1.5); // keeps the original time
  });

  it('upsert preserves in/out presets on the animation', () => {
    const base: OverlayAnimation = { in: { preset: 'fade', duration: 0.5, easing: 'linear' } };
    const anim = upsertKeyframe(base, 1, { opacity: 0.5 });
    expect(anim.in?.preset).toBe('fade');
  });

  it('findKeyframeIndexAt picks the nearest within epsilon, else -1', () => {
    const kfs = [{ t: 1, props: {} }, { t: 2, props: {} }];
    expect(findKeyframeIndexAt(kfs, 1.02)).toBe(0);
    expect(findKeyframeIndexAt(kfs, 1.5)).toBe(-1);
    expect(findKeyframeIndexAt(undefined, 1)).toBe(-1);
  });

  it('removeKeyframe clears the array entirely when the last one goes', () => {
    const anim = upsertKeyframe(undefined, 1, { x: 0.3 });
    expect(removeKeyframe(anim, 0)?.keyframes).toBeUndefined();
  });

  it('setKeyframeEasing updates only the target keyframe', () => {
    let anim = upsertKeyframe(undefined, 1, { x: 0 });
    anim = upsertKeyframe(anim, 2, { x: 1 });
    const next = setKeyframeEasing(anim, 1, 'easeOutBack')!;
    expect(next.keyframes![0].easing).toBe('easeInOutCubic');
    expect(next.keyframes![1].easing).toBe('easeOutBack');
  });

  it('shiftKeyframes re-anchors and drops out-of-range keyframes', () => {
    let anim: OverlayAnimation | undefined = { keyframes: [
      { t: 0.5, props: { x: 0 } }, { t: 2, props: { x: 1 } }, { t: 4, props: { x: 0 } },
    ] };
    anim = shiftKeyframes(anim, -1, 3); // left trim by 1s, new length 3
    expect(anim?.keyframes?.map(k => k.t)).toEqual([1, 3]); // 0.5→-0.5 dropped
  });
});

describe('base opacity/scale in the sampler', () => {
  it('feeds base values through when no keyframes exist', () => {
    const m = sampleOverlayMotion(
      { x: 0.5, y: 0.85, scale: 1.5, opacity: 0.4 }, undefined, 1, 5, 1920, 1080, BOUNDS,
    );
    expect(m.scale).toBe(1.5);
    expect(m.opacity).toBe(0.4);
  });

  it('keyframes override base values per channel', () => {
    const anim: OverlayAnimation = { keyframes: [{ t: 1, props: { opacity: 1 } }] };
    const m = sampleOverlayMotion(
      { x: 0.5, y: 0.85, scale: 1.5, opacity: 0.4 }, anim, 1, 5, 1920, 1080, BOUNDS,
    );
    expect(m.opacity).toBe(1);   // keyframed channel overrides
    expect(m.scale).toBe(1.5);   // un-keyframed channel keeps base
  });
});

describe('overlay operations with keyframes', () => {
  const overlayWithKfs = () => {
    const o = makeLowerThirdOverlay(1); // window 1..6, length 5
    o.animation = {
      ...o.animation,
      keyframes: [
        { t: 1, props: { opacity: 0 } },
        { t: 3, props: { opacity: 1 } },
      ],
    };
    return o;
  };

  it('left trim shifts keyframes to hold their absolute time', () => {
    let p = addOverlay(createEmptyProject(), overlayWithKfs());
    const id = p.overlays[0].id;
    p = updateOverlayById(p, id, { start: 2 }); // trim 1s off the front
    expect(p.overlays[0].animation?.keyframes?.map(k => k.t)).toEqual([0, 2]);
  });

  it('right trim drops keyframes beyond the new end', () => {
    let p = addOverlay(createEmptyProject(), overlayWithKfs());
    const id = p.overlays[0].id;
    p = updateOverlayById(p, id, { end: 3.5 }); // new length 2.5
    expect(p.overlays[0].animation?.keyframes?.map(k => k.t)).toEqual([1]);
  });

  it('moving the overlay (start+end together) keeps keyframes untouched', () => {
    let p = addOverlay(createEmptyProject(), overlayWithKfs());
    const id = p.overlays[0].id;
    p = updateOverlayById(p, id, { start: 4, end: 9 });
    expect(p.overlays[0].animation?.keyframes?.map(k => k.t)).toEqual([1, 3]);
  });

  it('split distributes keyframes and pins the sampled value at the cut', () => {
    let p = addOverlay(createEmptyProject(), overlayWithKfs());
    const id = p.overlays[0].id;
    p = splitOverlay(p, id, 3); // cut at local t=2, midway through the 1→3 ramp
    const [left, right] = p.overlays;
    // Left: original t=1 keyframe + pin at the cut (t=2) with opacity 0.5
    expect(left.animation?.keyframes?.map(k => k.t)).toEqual([1, 2]);
    expect(left.animation?.keyframes?.[1].props.opacity).toBeCloseTo(0.5);
    // Right: pin at 0 with opacity 0.5 + re-based t=3 → t=1
    expect(right.animation?.keyframes?.map(k => k.t)).toEqual([0, 1]);
    expect(right.animation?.keyframes?.[0].props.opacity).toBeCloseTo(0.5);
    expect(right.animation?.keyframes?.[1].props.opacity).toBe(1);
    // Neither half jumps at the cut boundary
    const base: AnimatableProps = { x: 0.5, y: 0.85, scale: 1, opacity: 1, rotation: 0 };
    const atCutLeft = sampleKeyframeProps(base, left.animation!.keyframes!, 2);
    const atCutRight = sampleKeyframeProps(base, right.animation!.keyframes!, 0);
    expect(atCutLeft.opacity).toBeCloseTo(atCutRight.opacity);
  });

  it('retimeOverlayKeyframe clamps to the overlay window', () => {
    let p = addOverlay(createEmptyProject(), overlayWithKfs());
    const id = p.overlays[0].id;
    p = retimeOverlayKeyframe(p, id, 1, 99);
    expect(p.overlays[0].animation?.keyframes?.[1].t).toBe(5); // clamped to length
    p = retimeOverlayKeyframe(p, id, 0, -3);
    expect(p.overlays[0].animation?.keyframes?.[0].t).toBe(0);
  });
});
