import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { useTeleprompter } from '@/contexts/TeleprompterContext';
import type { ScriptWord } from '@/lib/teleprompterMatch';

/** Fraction of the panel height the active word is held at. */
const ANCHOR = 0.4;

const Word = memo(function Word({ word, state }: {
  word: ScriptWord;
  state: 'past' | 'current' | 'future';
}) {
  return (
    <span
      data-active={state === 'current' || undefined}
      className={
        // Cross-dissolve between words: as the pointer moves A→B, A fades/dims
        // from 'current' to 'past' while B brightens from 'future' to 'current'.
        // A single eased opacity+color transition on every word reads as one word
        // dissolving into the next instead of a hard pop. Future words sit dim so
        // the brighten into 'current' is a visible fade-up.
        'transition-all duration-300 ease-in-out ' + (
          state === 'current'
            ? 'text-primary font-semibold opacity-100'
            : state === 'past'
              ? 'opacity-40'
              : 'opacity-60')
      }
    >
      {word.raw}{' '}
    </span>
  );
});

/**
 * Host-only teleprompter, layered in front of the video preview. It renders
 * only in the DOM and is never drawn into the broadcast compositor, so it is
 * invisible to viewers and to recordings by construction.
 */
export function TeleprompterOverlay() {
  const { visible, words, wordIndex, opacity, fontSize, mode, status, scrollSpeed } = useTeleprompter();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Voice-follow: continuously glide the active word toward the ANCHOR line.
  //
  // A single rAF lerp loop — NOT a per-update scrollTo({behavior:'smooth'}) —
  // is what makes this fluid. Each frame we ease scrollTop a fraction of the way
  // to the target, re-reading the active word from the DOM. So when the pointer
  // jumps several words at once (one recognition pass returns a chunk), the
  // scroll SWEEPS smoothly through them instead of teleporting; and because the
  // loop just re-targets (never restarts a fixed-duration animation), bursts of
  // rapid updates never stutter or fight each other.
  useEffect(() => {
    if (mode !== 'speech' || !visible) return;
    const container = scrollRef.current;
    if (!container) return;
    // Two-part motion, frame-rate independent (via dt so it's identical at
    // 60/120 Hz):
    //  • Exponential approach with a short time constant → small moves (the
    //    common case: pointer advances a word or two) catch your voice quickly,
    //    so the follow doesn't feel laggy.
    //  • A velocity CAP → when the pointer leaps many words at once, the scroll
    //    sweeps through them at a readable rate instead of snapping. Without the
    //    cap, a proportional ease still covers most of a big jump on frame one
    //    (that was the residual "snap on big jumps").
    const TIME_CONSTANT = 0.08;    // s — small-move responsiveness
    const MAX_SWEEP_PER_SEC = 2.2; // panel-heights/sec ceiling for big jumps
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const active = container.querySelector<HTMLElement>('[data-active]');
      if (active) {
        const target = active.offsetTop - container.clientHeight * ANCHOR;
        const delta = target - container.scrollTop;
        if (Math.abs(delta) < 0.5) {
          container.scrollTop = target; // settle exactly
        } else {
          let move = delta * (1 - Math.exp(-dt / TIME_CONSTANT));
          const maxStep = container.clientHeight * MAX_SWEEP_PER_SEC * dt;
          if (move > maxStep) move = maxStep;
          else if (move < -maxStep) move = -maxStep;
          container.scrollTop += move;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [mode, visible]);

  // Re-anchor on a font-size change. Enlarging the text reflows every word (a
  // bigger line-height pushes the active word down), so without this the current
  // line slides out of view and the following text is "buried" below the panel.
  // Runs in a layout effect — after the reflow, before paint — so we snap the
  // active word straight back to the anchor with no visible jump. (The glide
  // loop above eventually corrects too, but only in speech mode and with a
  // visible sweep; this makes resize instant and covers a paused pointer.)
  useLayoutEffect(() => {
    if (mode !== 'speech') return;
    const container = scrollRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>('[data-active]');
    if (active) container.scrollTop = active.offsetTop - container.clientHeight * ANCHOR;
  }, [fontSize, mode, visible]);

  // Auto-scroll: advance scrollTop at a constant rate via rAF.
  useEffect(() => {
    if (mode !== 'auto' || status !== 'running' || !visible) return;
    const container = scrollRef.current;
    if (!container) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      container.scrollTop += scrollSpeed * dt;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [mode, status, visible, scrollSpeed]);

  if (!visible || words.length === 0) return null;

  return (
    <div
      className="absolute z-30 left-[8%] right-[8%] top-[6%] h-[45%] overflow-hidden"
      style={{ backgroundColor: `rgba(0,0,0,${opacity / 100})` }}
    >
      {/* `relative` so word offsetTop is measured against this scroll
          container (not the positioned panel), keeping voice-follow scroll
          tracking accurate. Text carries its own shadow so it stays legible
          even when the background is fully transparent. */}
      <div
        ref={scrollRef}
        className="relative h-full overflow-y-auto px-6 py-4 text-white leading-relaxed [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ fontSize, textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.55)' }}
      >
        {words.map((w, i) => (
          <Word
            key={i}
            word={w}
            state={i === wordIndex ? 'current' : i < wordIndex ? 'past' : 'future'}
          />
        ))}
      </div>
    </div>
  );
}
