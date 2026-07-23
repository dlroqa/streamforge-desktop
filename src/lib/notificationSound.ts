/**
 * Forge Chat notification chime.
 *
 * A short, distinct two-note rising chime the host studio plays when an invited
 * guest sends a backstage message — deliberately different from any stream/UI
 * sound so the operator recognizes it without looking. Synthesized with the Web
 * Audio API (no asset files), through a single lazily-created, reused context.
 */

/**
 * Decide whether a Forge Chat update should chime. Pure so the trigger is
 * testable: chime only when the feed GREW and at least one of the new messages
 * is incoming (not our own). `seen === null` means first observation (mount /
 * reconnect) — never chimes, just records the baseline. A shrunk feed (stream
 * ended, history cleared) resyncs silently. Always returns the new baseline.
 */
export function evaluateChime(
  seen: number | null,
  messages: ReadonlyArray<{ mine: boolean }>,
): { chime: boolean; nextSeen: number } {
  const len = messages.length;
  if (seen === null || len <= seen) return { chime: false, nextSeen: len };
  const chime = messages.slice(seen).some(m => !m.mine);
  return { chime, nextSeen: len };
}

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try { ctx = new AC(); } catch { return null; }
  }
  return ctx;
}

/**
 * Play the chime at `volume` (0–100). No-op at 0 or when Web Audio is
 * unavailable. Browsers may keep the context suspended until a user gesture;
 * we resume opportunistically, so the very first alert may be silent until the
 * operator has interacted with the page (e.g. used the Test button).
 */
export function playForgeChime(volume: number): void {
  const v = Math.max(0, Math.min(100, volume)) / 100;
  if (v <= 0) return;
  const ac = getCtx();
  if (!ac) return;
  if (ac.state === 'suspended') ac.resume().catch(() => { /* needs a gesture */ });

  const now = ac.currentTime;
  const master = ac.createGain();
  master.gain.value = v * 0.5; // headroom so it's a soft alert, not a blast
  master.connect(ac.destination);

  // Rising minor-third-ish two-note motif ("bip-boop").
  const notes = [
    { freq: 660, at: 0 },
    { freq: 988, at: 0.12 },
  ];
  for (const n of notes) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = n.freq;
    const start = now + n.at;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(1, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, start + 0.3);
    osc.connect(g);
    g.connect(master);
    osc.start(start);
    osc.stop(start + 0.32);
  }
}
