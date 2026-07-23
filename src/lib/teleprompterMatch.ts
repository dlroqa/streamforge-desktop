/**
 * Word-matching logic for the teleprompter's voice-follow mode.
 *
 * The script is tokenized once into normalized words. As speech recognition
 * produces (interim) transcripts, the last few spoken words are aligned
 * against a small lookahead window past the current pointer; on a confident
 * alignment the pointer advances. The pointer never moves backward — a
 * misrecognition should stall briefly, not yank the script up.
 */

export interface ScriptWord {
  raw: string;   // original token, for rendering
  norm: string;  // normalized form, for matching ('' if punctuation-only)
}

export function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function tokenizeScript(script: string): ScriptWord[] {
  return script
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(raw => ({ raw, norm: normalizeWord(raw) }));
}

// Levenshtein distance capped at 2 — enough to decide "distance <= 1"
// cheaply without building the full matrix for long words.
function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  // One substitution
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff <= 1;
  }
  // One insertion/deletion
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

function wordsMatch(spoken: string, script: string): boolean {
  if (spoken === script) return true;
  if (spoken.length >= 4 && script.length >= 4 && editDistanceAtMost1(spoken, script)) return true;
  // Interim results often carry a partially recognized final word.
  if (spoken.length >= 3 && script.startsWith(spoken)) return true;
  return false;
}

/**
 * Returns the new pointer (index of the next unread script word). Advances
 * only on an alignment of at least `minMatches` spoken words against the
 * lookahead window; otherwise returns `pointer` unchanged. Never regresses.
 */
export function matchTranscript(
  scriptNorms: string[],
  pointer: number,
  spokenTail: string[],
  lookahead = 18,
): number {
  if (pointer >= scriptNorms.length || spokenTail.length === 0) return pointer;

  // Indices of the next `lookahead` matchable (non-empty) script words.
  const window: number[] = [];
  for (let i = pointer; i < scriptNorms.length && window.length < lookahead; i++) {
    if (scriptNorms[i]) window.push(i);
  }
  if (window.length === 0) return pointer;

  const minMatches = spokenTail.length === 1 ? 1 : 2;
  let bestCount = 0;
  let bestEnd = -1;

  // Try each window position as the alignment end for the spoken tail, then
  // walk backward through both sequences counting matches.
  for (let end = 0; end < window.length; end++) {
    let count = 0;
    let w = end;
    for (let s = spokenTail.length - 1; s >= 0 && w >= 0; s--) {
      if (wordsMatch(spokenTail[s], scriptNorms[window[w]])) {
        count++;
        w--;
      }
    }
    // Prefer the earliest end with the best count to avoid jumping past
    // repeated phrases.
    if (count > bestCount) {
      bestCount = count;
      bestEnd = end;
    }
  }

  if (bestCount < minMatches) return pointer;
  return window[bestEnd] + 1;
}
