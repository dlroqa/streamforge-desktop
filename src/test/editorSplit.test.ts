import { describe, it, expect } from 'vitest';
import {
  createEmptyProject, makeAudioClip, makeTextOverlay, addOverlay,
  addAudioClip, splitAudioClip, splitOverlay, splitAllAt, appendClip,
} from '@/lib/editorProject';

describe('appendClip placement', () => {
  it('places the first video at t=0 even when a long audio clip is present', () => {
    let p = createEmptyProject();
    p = addAudioClip(p, makeAudioClip('song', 'Back Then', 220, 0)); // 3:40 audio
    p = appendClip(p, { recordingId: 'r1', name: 'Clip', sourceDuration: 10 });
    expect(p.clips).toHaveLength(1);
    expect(p.clips[0].timelineStart).toBe(0); // not 220 (the audio's end)
  });

  it('appends a second video after the first on the video track', () => {
    let p = createEmptyProject();
    p = appendClip(p, { recordingId: 'r1', name: 'A', sourceDuration: 10 });
    p = appendClip(p, { recordingId: 'r2', name: 'B', sourceDuration: 5 });
    expect(p.clips[1].timelineStart).toBeCloseTo(10);
  });
});

describe('splitAudioClip', () => {
  it('splits an audio clip into two contiguous halves at the playhead', () => {
    let p = createEmptyProject();
    const a = makeAudioClip('asset-1', 'Song', 10, 0); // 0..10 on the timeline
    p = addAudioClip(p, a);
    const out = splitAudioClip(p, a.id, 4);
    expect(out.audioClips).toHaveLength(2);
    const [left, right] = out.audioClips;
    expect(left.outPoint).toBeCloseTo(4);
    expect(right.inPoint).toBeCloseTo(4);
    expect(right.timelineStart).toBeCloseTo(4);
    // left ends exactly where right begins (no gap/overlap)
    expect(left.timelineStart + (left.outPoint - left.inPoint)).toBeCloseTo(right.timelineStart);
  });

  it('refuses to split too close to an edge', () => {
    let p = createEmptyProject();
    const a = makeAudioClip('asset-1', 'Song', 10, 0);
    p = addAudioClip(p, a);
    expect(splitAudioClip(p, a.id, 0.01).audioClips).toHaveLength(1);
  });
});

describe('splitOverlay', () => {
  it('splits an overlay into two adjacent windows', () => {
    let p = createEmptyProject();
    const o = makeTextOverlay(0); // default window starts at 0
    p = addOverlay(p, { ...o, start: 0, end: 6 });
    const out = splitOverlay(p, o.id, 2);
    expect(out.overlays).toHaveLength(2);
    expect(out.overlays[0].end).toBeCloseTo(2);
    expect(out.overlays[1].start).toBeCloseTo(2);
  });
});

describe('splitAllAt razor', () => {
  it('cuts video, audio, and overlay crossing the playhead in one pass', () => {
    let p = createEmptyProject();
    p = appendClip(p, { recordingId: 'r1', name: 'Clip', sourceDuration: 10 }); // 0..10 video
    p = addAudioClip(p, makeAudioClip('asset-1', 'Song', 10, 0));
    p = addOverlay(p, { ...makeTextOverlay(0), start: 0, end: 8 });
    const out = splitAllAt(p, 3);
    expect(out.clips).toHaveLength(2);
    expect(out.audioClips).toHaveLength(2);
    expect(out.overlays).toHaveLength(2);
  });
});
