import { describe, it, expect } from 'vitest';
import { normalizeWord, tokenizeScript, matchTranscript } from '@/lib/teleprompterMatch';

const script = (text: string) => tokenizeScript(text).map(w => w.norm);

describe('normalizeWord', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeWord('Hello,')).toBe('hello');
    expect(normalizeWord("don't")).toBe('dont');
    expect(normalizeWord('—')).toBe('');
  });

  it('strips diacritics', () => {
    expect(normalizeWord('café')).toBe('cafe');
  });
});

describe('tokenizeScript', () => {
  it('keeps raw tokens alongside normalized forms', () => {
    const words = tokenizeScript('Hello, world!');
    expect(words).toEqual([
      { raw: 'Hello,', norm: 'hello' },
      { raw: 'world!', norm: 'world' },
    ]);
  });

  it('ignores blank runs', () => {
    expect(tokenizeScript('  a \n\n b ')).toHaveLength(2);
  });
});

describe('matchTranscript', () => {
  const norms = script(
    'Welcome back to the channel today we are going to talk about live streaming tools',
  );

  it('advances on verbatim reading', () => {
    // Spoke: "welcome back to the"
    const next = matchTranscript(norms, 0, ['welcome', 'back', 'to', 'the']);
    expect(next).toBe(4);
  });

  it('re-syncs when a word is skipped or misread', () => {
    // Reader skipped "back": spoke "welcome to the channel"
    const next = matchTranscript(norms, 0, ['welcome', 'to', 'the', 'channel']);
    expect(next).toBe(5); // pointer lands after "channel"
  });

  it('does not jump on a single common filler word', () => {
    // Just "the" alone amid a longer tail shouldn't confidently advance far
    const next = matchTranscript(norms, 0, ['um', 'uh', 'so']);
    expect(next).toBe(0);
  });

  it('matches interim partial words by prefix', () => {
    // "streami" is an interim fragment of "streaming"
    const idx = norms.indexOf('live');
    const next = matchTranscript(norms, idx, ['live', 'streami']);
    expect(next).toBe(idx + 2);
  });

  it('tolerates a one-letter misrecognition on longer words', () => {
    // "chanel" vs "channel" (edit distance 1, length >= 4)
    const next = matchTranscript(norms, 0, ['welcome', 'back', 'to', 'the', 'chanel']);
    expect(next).toBe(5);
  });

  it('never moves the pointer backward', () => {
    const next = matchTranscript(norms, 8, ['welcome', 'back']);
    expect(next).toBe(8);
  });

  it('prefers the earliest alignment for repeated words', () => {
    const rep = script('one two one two three');
    const next = matchTranscript(rep, 0, ['one', 'two']);
    expect(next).toBe(2); // first "one two", not the second
  });

  it('clamps to the lookahead window', () => {
    // Doubled index keeps distant words > 1 edit apart (word50 vs word0 is
    // edit distance 1 and would legitimately fuzzy-match).
    const long = script(Array.from({ length: 100 }, (_, i) => `w${i}n${i}`).join(' '));
    const next = matchTranscript(long, 0, ['w50n50', 'w51n51'], 18);
    expect(next).toBe(0); // outside the window — no jump
  });

  it('handles pointer at end of script', () => {
    expect(matchTranscript(norms, norms.length, ['tools'])).toBe(norms.length);
  });

  it('single-word tail can advance by one', () => {
    const next = matchTranscript(norms, 0, ['welcome']);
    expect(next).toBe(1);
  });

  it('a long catch-up transcript advances when walked in chunks', () => {
    // Whisper running behind real-time delivers one long transcript covering
    // ~30 words — far past the 18-word lookahead. Matching only its tail
    // stalls forever; walking it in chunks of 5 (as feedSpoken does) must
    // carry the pointer through to the end.
    const long = script(Array.from({ length: 100 }, (_, i) => `w${i}n${i}`).join(' '));
    const spoken = Array.from({ length: 30 }, (_, i) => `w${i}n${i}`);

    // Tail-only (the old behavior): no progress at all.
    expect(matchTranscript(long, 0, spoken.slice(-5))).toBe(0);

    // Chunked walk: ends up right after the last spoken word.
    let pointer = 0;
    for (let i = 0; i < spoken.length; i += 5) {
      pointer = matchTranscript(long, pointer, spoken.slice(i, i + 5));
    }
    expect(pointer).toBe(30);
  });
});
