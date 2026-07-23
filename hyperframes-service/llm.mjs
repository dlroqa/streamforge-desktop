// LLM authoring mode: Claude writes a bespoke HyperFrames composition from the
// user's prompt. Only active when ANTHROPIC_API_KEY is set; the server's
// /health reports availability so the app can grey out the AI tab.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.HYPERFRAMES_MODEL || 'claude-opus-4-8';

export function llmAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Condensed HyperFrames composition contract. The renderer loads the page in
// headless Chrome and reads window.__timelines synchronously, so every rule
// here is load-bearing — violations fail lint or produce a broken capture.
function systemPrompt({ width, height, duration, format }) {
  const alpha = format === 'webm';
  return `You are an expert motion designer authoring a HyperFrames video composition. HyperFrames renders a single standalone HTML page to video in headless Chrome: data-* attributes define timing, CSS defines appearance, and a GSAP timeline defines motion.

Output EXACTLY one complete HTML document and nothing else — no markdown fences, no commentary.

Hard requirements (violations break the render):
- Standalone document. Do NOT wrap content in <template>.
- Body contains one root element: <div data-composition-id="mg" data-width="${width}" data-height="${height}" data-start="0" data-duration="${duration}" data-track-index="0"> ... </div>
- Load GSAP with <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script> after the root div.
- Then a plain inline <script> that builds the timeline SYNCHRONOUSLY (no async/await/setTimeout/Promises) as: window.__timelines = window.__timelines || {}; const tl = gsap.timeline({ paused: true }); ...tweens...; window.__timelines["mg"] = tl;
- Deterministic only: no Math.random(), no Date.now(), no time-based logic. Use a seeded PRNG (e.g. mulberry32) if pseudo-randomness is needed.
- NEVER use repeat: -1. Compute finite repeats from the duration: repeat: Math.ceil(span / cycleDuration) - 1.
- Only animate visual properties (opacity, x, y, scale, rotation, color, backgroundColor, clipPath, transforms). Never animate visibility/display; never call play()/pause() on anything.
- No external assets other than the GSAP CDN script. No images, no video, no audio, no font files. Declare font-family in CSS using ONLY these embedded families (anything else fails lint): Inter, Montserrat, Outfit, Poppins, Oswald, Lato, Nunito, Open Sans, Roboto, Playfair Display, EB Garamond, League Gothic, Archivo Black, Space Mono, JetBrains Mono, IBM Plex Mono, Source Code Pro.
${alpha
    ? `- TRANSPARENT OUTPUT: this renders to alpha WebM for use as a live-stream overlay. html, body { margin: 0; background: transparent; } and NO opaque element may cover the full canvas. Everything you draw floats over live video, so give text strong contrast (text-shadow or backing plates behind text are fine — full-canvas backgrounds are not).`
    : `- OPAQUE OUTPUT (MP4): give html/body margin 0 and design a full-canvas background. Avoid full-screen linear gradients on dark colors (H.264 banding) — prefer solid color plus a localized radial glow.`}

Design rules:
- The composition is ${width}x${height}, ${duration}s long. Content container fills the scene with width/height 100% + padding + flex (box-sizing: border-box). Never absolutely position the main content container; reserve position:absolute for decorative elements.
- Rendered-video legibility: headlines 60px+, body text 20px+.
- First animation starts at 0.1–0.3s, not t=0. Vary easings across entrance tweens (use at least 3 different eases). Animate every element IN with gsap.from(); exit animations (gsap.to toward invisible) only in the final ~0.7s before ${duration}s.
- Keep it tasteful and broadcast-quality: strong typographic hierarchy, one accent color, restrained motion.`;
}

async function requestComposition(client, system, messages) {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    system,
    messages,
  });
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') {
    throw new Error('The model declined to generate this composition. Try rephrasing the prompt.');
  }
  if (final.stop_reason === 'max_tokens') {
    throw new Error('The generated composition was truncated. Try a simpler prompt.');
  }
  const text = final.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return extractHtml(text);
}

/** The model is told not to fence its output, but strip fences defensively. */
function extractHtml(text) {
  let t = text.trim();
  const fenced = t.match(/```(?:html)?\s*\n([\s\S]*?)```/);
  if (fenced) t = fenced[1].trim();
  const start = t.search(/<!doctype html|<html/i);
  if (start === -1) throw new Error('The model did not return an HTML document.');
  return t.slice(start);
}

/** Author a composition from the prompt. `repair` re-enters with lint errors. */
export async function authorComposition({ prompt, width, height, duration, format, accentColor }) {
  const client = new Anthropic();
  const system = systemPrompt({ width, height, duration, format });
  const messages = [{
    role: 'user',
    content:
      `Create a motion graphic for a live stream: ${prompt.trim()}` +
      (accentColor ? `\nAccent color: ${accentColor}` : '') +
      `\nCanvas: ${width}x${height}, duration ${duration}s, ${format === 'webm' ? 'transparent overlay' : 'opaque full-frame'} output.`,
  }];
  const html = await requestComposition(client, system, messages);
  return { html, messages };
}

/** One repair round: feed lint/validate errors back and get corrected HTML. */
export async function repairComposition({ messages, html, errors, width, height, duration, format }) {
  const client = new Anthropic();
  const system = systemPrompt({ width, height, duration, format });
  const followup = [
    ...messages,
    { role: 'assistant', content: html },
    {
      role: 'user',
      content:
        `The HyperFrames linter rejected that composition. Fix every issue and output the complete corrected HTML document (nothing else):\n\n${errors}`,
    },
  ];
  return requestComposition(client, system, followup);
}
