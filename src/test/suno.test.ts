import { describe, it, expect } from 'vitest';
import { classifySunoUrl, sunoMp3Url, resolveSunoTracks } from '@/lib/suno';

const SONG = '11111111-2222-3333-4444-555555555555';

describe('classifySunoUrl', () => {
  it('recognises song links and bare UUIDs', () => {
    expect(classifySunoUrl(`https://suno.com/song/${SONG}`)).toBe('song');
    expect(classifySunoUrl(`https://app.suno.ai/song/${SONG}`)).toBe('song');
    expect(classifySunoUrl(`suno.com/song/${SONG}?sh=abc`)).toBe('song');
    expect(classifySunoUrl(SONG)).toBe('song');
  });

  it('recognises short share links', () => {
    expect(classifySunoUrl('https://suno.com/s/1R1997mWVPnobB0U')).toBe('short');
  });

  it('recognises playlist links', () => {
    expect(classifySunoUrl(`https://suno.com/playlist/${SONG}`)).toBe('playlist');
  });

  it('rejects unrelated or empty input', () => {
    expect(classifySunoUrl('')).toBe('invalid');
    expect(classifySunoUrl('https://example.com/song/x')).toBe('invalid');
    expect(classifySunoUrl('not a url')).toBe('invalid');
  });
});

describe('sunoMp3Url', () => {
  it('derives the public CDN mp3 url', () => {
    expect(sunoMp3Url(SONG)).toBe(`https://cdn1.suno.ai/${SONG}.mp3`);
  });
});

describe('resolveSunoTracks', () => {
  it('resolves a song link client-side (no backend call)', async () => {
    const r = await resolveSunoTracks(`https://suno.com/song/${SONG}`);
    expect(r.type).toBe('song');
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0].audioUrl).toBe(`https://cdn1.suno.ai/${SONG}.mp3`);
  });

  it('rejects an invalid link before any network call', async () => {
    await expect(resolveSunoTracks('nope')).rejects.toThrow();
  });
});
