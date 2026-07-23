// Built-in HyperFrames composition templates — the no-API-key generation path.
// Each template returns a complete standalone index.html following the
// HyperFrames composition contract: a root div with data-* timing attributes,
// GSAP loaded from CDN, and a paused timeline registered on window.__timelines.
// Timelines are deterministic (no Math.random/Date.now) with finite repeats.
//
// The look is built from four independent, user-controllable knobs so the same
// text can be dressed dozens of ways:
//   • template — the layout + its signature "hold" flourish
//   • enter/exit — how the whole graphic pops / swipes / flips on and off
//   • font — a premium web font (loaded from Google Fonts, graceful fallback)
//   • border — an animated frame (glow pulse, draw-on, marching ants, …)
//
// For transparent WebM output the page background stays transparent; for MP4
// (no alpha in H.264) we paint a solid dark backdrop so the graphic doesn't
// land on undefined black.

/** Escape user text for safe interpolation into the composition HTML. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** How many finite repeats fill a window with a given cycle length. */
function repeatsFor(win, cycle) {
  return Math.max(1, Math.ceil(win / cycle));
}

/** Monogram fallback for the news bug when no logo text is supplied. */
function monogram(s) {
  const parts = String(s ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '★';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// ---------------------------------------------------------------- fonts

/** Curated premium web fonts. `stack` always ends in a safe generic family so
 * the render still looks intentional if the web font fails to load. */
export const FONTS = {
  inter:        { label: 'Inter',            stack: '"Inter", system-ui, sans-serif',    g: 'Inter:wght@400;500;600;700;800;900' },
  montserrat:   { label: 'Montserrat',       stack: '"Montserrat", sans-serif',           g: 'Montserrat:wght@400;500;600;700;800;900' },
  poppins:      { label: 'Poppins',          stack: '"Poppins", sans-serif',              g: 'Poppins:wght@400;500;600;700;800' },
  spacegrotesk: { label: 'Space Grotesk',    stack: '"Space Grotesk", sans-serif',        g: 'Space+Grotesk:wght@400;500;600;700' },
  bebas:        { label: 'Bebas Neue',       stack: '"Bebas Neue", sans-serif',           g: 'Bebas+Neue' },
  oswald:       { label: 'Oswald',           stack: '"Oswald", sans-serif',               g: 'Oswald:wght@400;500;600;700' },
  anton:        { label: 'Anton',            stack: '"Anton", sans-serif',                g: 'Anton' },
  archivo:      { label: 'Archivo Black',    stack: '"Archivo Black", sans-serif',        g: 'Archivo+Black' },
  playfair:     { label: 'Playfair Display', stack: '"Playfair Display", serif',          g: 'Playfair+Display:ital,wght@0,500;0,600;0,700;0,800;1,600' },
  righteous:    { label: 'Righteous',        stack: '"Righteous", sans-serif',            g: 'Righteous' },
  orbitron:     { label: 'Orbitron',         stack: '"Orbitron", sans-serif',             g: 'Orbitron:wght@500;700;900' },
  pacifico:     { label: 'Pacifico',         stack: '"Pacifico", cursive',                g: 'Pacifico' },
};

function fontHead(fontId) {
  const f = FONTS[fontId] || FONTS.inter;
  const href = `https://fonts.googleapis.com/css2?family=${f.g}&display=swap`;
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${href}" rel="stylesheet">`;
}

// ---------------------------------------------------------------- enter / exit

/** GSAP `from` vars for an entrance (animates FROM these TO the resting state).
 * dx/dy are the off-screen travel distances; scale sizes the 3D flip depth. */
function enterVars(id, dx, dy, scale) {
  const flipZ = Math.round(140 * scale);
  switch (id) {
    case 'fade':        return { opacity: 0, duration: 0.6, ease: 'power2.out' };
    case 'pop':         return { scale: 0.3, opacity: 0, duration: 0.8, ease: 'back.out(1.7)' };
    case 'bounce':      return { y: -dy, opacity: 0, duration: 1.0, ease: 'bounce.out' };
    case 'zoom':        return { scale: 1.6, opacity: 0, duration: 0.8, ease: 'expo.out' };
    case 'swipe-left':  return { x: -dx, opacity: 0, duration: 0.75, ease: 'expo.out' };
    case 'swipe-right': return { x: dx, opacity: 0, duration: 0.75, ease: 'expo.out' };
    case 'swipe-up':    return { y: dy, opacity: 0, duration: 0.75, ease: 'expo.out' };
    case 'swipe-down':  return { y: -dy, opacity: 0, duration: 0.75, ease: 'expo.out' };
    case 'flip':        return { rotationX: -90, opacity: 0, duration: 0.85, ease: 'power2.out', transformOrigin: `50% 50% -${flipZ}px` };
    case 'blur':        return { '--mgb': 22, opacity: 0, duration: 0.8, ease: 'power2.out' };
    default:            return { y: dy, opacity: 0, duration: 0.75, ease: 'expo.out' };
  }
}

/** GSAP `to` vars for an exit (null = hold on screen through the end). */
function exitVars(id, dx, dy, scale) {
  const flipZ = Math.round(140 * scale);
  switch (id) {
    case 'none':        return null;
    case 'fade':        return { opacity: 0, duration: 0.5, ease: 'power2.in' };
    case 'pop':         return { scale: 0.3, opacity: 0, duration: 0.5, ease: 'back.in(1.6)' };
    case 'zoom':        return { scale: 1.6, opacity: 0, duration: 0.5, ease: 'power2.in' };
    case 'swipe-left':  return { x: -dx, opacity: 0, duration: 0.55, ease: 'power3.in' };
    case 'swipe-right': return { x: dx, opacity: 0, duration: 0.55, ease: 'power3.in' };
    case 'swipe-up':    return { y: -dy, opacity: 0, duration: 0.55, ease: 'power3.in' };
    case 'swipe-down':  return { y: dy, opacity: 0, duration: 0.55, ease: 'power3.in' };
    case 'flip':        return { rotationX: 90, opacity: 0, duration: 0.55, ease: 'power2.in', transformOrigin: `50% 50% -${flipZ}px` };
    case 'blur':        return { '--mgb': 22, opacity: 0, duration: 0.5, ease: 'power2.in' };
    default:            return { opacity: 0, duration: 0.5, ease: 'power2.in' };
  }
}

// ---------------------------------------------------------------- borders

/** An animated frame around the whole graphic. Returns the CSS, the markup
 * (placed inside .content so it enters/exits with the graphic) and a GSAP
 * fragment driving its own animation across the hold window. */
function borderLayer(id, ctx) {
  const { width, height, scale, holdStart, holdEnd, secondary } = ctx;
  const win = Math.max(0.5, holdEnd - holdStart);
  const inset = Math.round(44 * scale);
  const sw = Math.max(2, Math.round(6 * scale));
  const r = Math.round(20 * scale);
  const w = width - inset * 2;
  const h = height - inset * 2;
  const perim = Math.round(2 * (w + h) - 8 * r + 2 * Math.PI * r);

  if (!id || id === 'none') return { css: '', html: '', timeline: '' };

  const svgOpen = `<svg class="frame" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`;
  const baseCss = '.frame{position:absolute;inset:0;pointer-events:none;overflow:visible;}';

  if (id === 'draw') {
    return {
      css: baseCss,
      html: `${svgOpen}<rect class="fr" x="${inset}" y="${inset}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="none" stroke="var(--accent)" stroke-width="${sw}" style="stroke-dasharray:${perim};"/></svg>`,
      timeline: `  tl.from(".fr", { strokeDashoffset: ${perim}, opacity: 0, duration: 1.1, ease: "power2.inOut" }, ${(holdStart - 0.15).toFixed(2)});`,
    };
  }

  if (id === 'marching') {
    const dash = Math.max(10, Math.round(22 * scale));
    const gap = Math.max(8, Math.round(16 * scale));
    const cyc = dash + gap;
    return {
      css: baseCss,
      html: `${svgOpen}<rect class="fr" x="${inset}" y="${inset}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="none" stroke="var(--accent)" stroke-width="${sw}" stroke-linecap="round" style="stroke-dasharray:${dash} ${gap};"/></svg>`,
      timeline: `  tl.from(".fr", { opacity: 0, duration: 0.4 }, ${(holdStart - 0.2).toFixed(2)});
  tl.to(".fr", { strokeDashoffset: -${cyc}, duration: 0.55, ease: "none", repeat: ${repeatsFor(win, 0.55)} }, ${holdStart.toFixed(2)});`,
    };
  }

  if (id === 'glow') {
    return {
      css: `.frame{position:absolute;inset:${inset}px;border:${sw}px solid var(--accent);border-radius:${r}px;pointer-events:none;--glow:6;filter:drop-shadow(0 0 calc(var(--glow)*1px) var(--accent));}`,
      html: '<div class="frame"></div>',
      timeline: `  tl.from(".frame", { opacity: 0, scale: 1.04, duration: 0.5, ease: "power2.out" }, ${(holdStart - 0.25).toFixed(2)});
  tl.to(".frame", { "--glow": 28, duration: 0.9, ease: "sine.inOut", repeat: ${repeatsFor(win, 0.9)}, yoyo: true }, ${holdStart.toFixed(2)});`,
    };
  }

  if (id === 'gradient') {
    const sec = secondary || '#ffffff';
    return {
      css: `.frame{position:absolute;inset:${inset}px;border-radius:${r}px;padding:${sw}px;pointer-events:none;--ang:0;background:conic-gradient(from calc(var(--ang)*1deg), var(--accent), ${sec}, var(--accent));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;}`,
      html: '<div class="frame"></div>',
      timeline: `  tl.from(".frame", { opacity: 0, duration: 0.5, ease: "power2.out" }, ${(holdStart - 0.25).toFixed(2)});
  tl.to(".frame", { "--ang": 360, duration: 3, ease: "none", repeat: ${repeatsFor(win, 3)} }, ${holdStart.toFixed(2)});`,
    };
  }

  if (id === 'corners') {
    const cs = Math.round(90 * scale);
    return {
      css: `.frame{position:absolute;inset:${inset}px;pointer-events:none;}
  .cnr{position:absolute;width:${cs}px;height:${cs}px;border:${sw}px solid var(--accent);}
  .cnr.tl{top:0;left:0;border-right:0;border-bottom:0;}
  .cnr.tr{top:0;right:0;border-left:0;border-bottom:0;}
  .cnr.bl{bottom:0;left:0;border-right:0;border-top:0;}
  .cnr.br{bottom:0;right:0;border-left:0;border-top:0;}`,
      html: '<div class="frame"><span class="cnr tl"></span><span class="cnr tr"></span><span class="cnr bl"></span><span class="cnr br"></span></div>',
      timeline: `  tl.from(".cnr", { scale: 0, opacity: 0, duration: 0.5, ease: "back.out(2)", stagger: 0.08 }, ${(holdStart - 0.1).toFixed(2)});`,
    };
  }

  return { css: '', html: '', timeline: '' };
}

// ---------------------------------------------------------------- page shell

function page({ width, height, duration, transparent, accent, secondary, fontId, css, body, timeline }) {
  const f = FONTS[fontId] || FONTS.inter;
  const bg = transparent ? 'background: transparent;' : 'background: #0b0b0f;';
  const backdrop = transparent ? '' : `
  .backdrop { position: absolute; inset: 0;
    background: radial-gradient(ellipse at 50% 38%, #191922 0%, #0b0b0f 72%); }`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${fontHead(fontId)}
<style>
  html, body { margin: 0; padding: 0; ${bg} }
  [data-composition-id="mg"] {
    position: relative; width: 100%; height: 100%; overflow: hidden;
    font-family: ${f.stack};
    --accent: ${accent};
    --secondary: ${secondary || '#ffffff'};
  }
  .content { position: absolute; inset: 0; --mgb: 0; filter: blur(calc(var(--mgb) * 1px)); }${backdrop}
${css}
</style>
</head>
<body>
<div data-composition-id="mg" data-width="${width}" data-height="${height}"
     data-start="0" data-duration="${duration}" data-track-index="0">
${transparent ? '' : '  <div class="backdrop"></div>\n'}  <div class="content">
${body}
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const D = ${duration};
  const tl = gsap.timeline({ paused: true });
${timeline}
  window.__timelines["mg"] = tl;
</script>
</body>
</html>
`;
}

/**
 * Shared builder: wraps a template's markup in .content, applies the generic
 * enter/exit knobs to the whole group, layers on the chosen animated border,
 * and splices in the template's signature "hold" flourish.
 *
 * spec = { css, body, defaultEnter, defaultExit, defaultFont?, flourish(ctx) }
 */
function compose(opts, spec) {
  const { width, height, duration } = opts;
  const scale = Math.min(width, 1920) / 1920;
  const dx = width, dy = height;

  const enterId = opts.enter && opts.enter !== 'auto' ? opts.enter : spec.defaultEnter;
  const exitId = opts.exit === 'auto' || opts.exit == null ? spec.defaultExit : opts.exit;
  const fontId = opts.font && opts.font !== 'auto' ? opts.font : (spec.defaultFont || 'inter');

  const eVars = enterVars(enterId, dx, dy, scale);
  const xVars = exitVars(exitId, dx, dy, scale);

  const enterAt = 0.2;
  const holdStart = enterAt + eVars.duration;
  const exitAt = xVars ? Math.max(holdStart + 0.4, duration - xVars.duration - 0.05) : null;
  const holdEnd = xVars ? exitAt : duration;

  const border = borderLayer(opts.border, {
    width, height, scale, holdStart, holdEnd, secondary: opts.secondary,
  });

  const ctx = { holdStart, holdEnd, scale, duration, width, height, accent: opts.accent };
  const flourish = spec.flourish ? spec.flourish(ctx) : '';

  const timeline = [
    `  tl.from(".content", ${JSON.stringify(eVars)}, ${enterAt});`,
    border.timeline,
    flourish,
    xVars ? `  tl.to(".content", ${JSON.stringify(xVars)}, ${exitAt.toFixed(2)});` : '',
  ].filter(Boolean).join('\n');

  return page({
    width, height, duration, transparent: opts.transparent,
    accent: opts.accent, secondary: opts.secondary, fontId,
    css: `${spec.css}\n${border.css}`,
    body: `${border.html}\n${spec.body}`,
    timeline,
  });
}

// ---------------------------------------------------------------- templates

/** Centered stacked headline with a subtitle + accent rule. */
function kineticTitle(opts) {
  const { line1, line2, width } = opts;
  const s = Math.min(width, 1920) / 1920;
  return compose(opts, {
    defaultEnter: 'swipe-up', defaultExit: 'fade',
    css: `
  .scene { display:flex; flex-direction:column; justify-content:center; align-items:center;
    width:100%; height:100%; padding:${Math.round(120 * s)}px; gap:${Math.round(28 * s)}px;
    box-sizing:border-box; text-align:center; }
  .headline { font-size:${Math.round(128 * s)}px; font-weight:800; line-height:1.05;
    letter-spacing:-0.02em; color:#fff; margin:0; text-shadow:0 4px 32px rgba(0,0,0,.45); max-width:92%; }
  .subtitle { font-size:${Math.round(44 * s)}px; font-weight:500; margin:0; color:var(--accent);
    letter-spacing:.04em; text-shadow:0 2px 16px rgba(0,0,0,.45); }
  .rule { width:${Math.round(120 * s)}px; height:${Math.round(6 * s)}px; background:var(--accent); border-radius:3px; }`,
    body: `    <div class="scene">
      <h1 class="headline">${esc(line1)}</h1>
      ${line2 ? `<div class="rule"></div>\n      <p class="subtitle">${esc(line2)}</p>` : ''}
    </div>`,
    flourish: ({ holdStart }) => `  tl.from(".rule", { scaleX: 0, transformOrigin: "left center", duration: 0.5, ease: "expo.out" }, ${(holdStart + 0.05).toFixed(2)});
  tl.from(".subtitle", { y: 24, opacity: 0, duration: 0.5, ease: "power2.out" }, ${(holdStart + 0.15).toFixed(2)});`,
  });
}

/** Broadcast lower third: name + role plate, bottom-left. */
function lowerThird(opts) {
  const { line1, line2, width } = opts;
  const s = Math.min(width, 1920) / 1920;
  return compose(opts, {
    defaultEnter: 'swipe-left', defaultExit: 'swipe-left',
    css: `
  .scene { display:flex; flex-direction:column; justify-content:flex-end; align-items:flex-start;
    width:100%; height:100%; padding:${Math.round(90 * s)}px ${Math.round(110 * s)}px; box-sizing:border-box; }
  .plate { display:flex; align-items:stretch; gap:${Math.round(22 * s)}px; background:rgba(12,12,18,.82);
    border-radius:${Math.round(10 * s)}px; padding:${Math.round(24 * s)}px ${Math.round(40 * s)}px ${Math.round(24 * s)}px ${Math.round(28 * s)}px;
    box-shadow:0 10px 40px rgba(0,0,0,.35); overflow:hidden; }
  .bar { width:${Math.round(10 * s)}px; border-radius:5px; background:var(--accent); }
  .txt { display:flex; flex-direction:column; gap:${Math.round(6 * s)}px; }
  .name { font-size:${Math.round(56 * s)}px; font-weight:700; color:#fff; line-height:1.1; margin:0; white-space:nowrap; }
  .role { font-size:${Math.round(30 * s)}px; font-weight:500; margin:0; color:var(--accent);
    letter-spacing:.06em; text-transform:uppercase; white-space:nowrap; }`,
    body: `    <div class="scene">
      <div class="plate">
        <div class="bar"></div>
        <div class="txt">
          <p class="name">${esc(line1)}</p>
          ${line2 ? `<p class="role">${esc(line2)}</p>` : ''}
        </div>
      </div>
    </div>`,
    flourish: ({ holdStart }) => `  tl.from(".bar", { scaleY: 0, transformOrigin: "top center", duration: 0.5, ease: "power3.out" }, ${(holdStart - 0.1).toFixed(2)});
  tl.from(".name", { y: 30, opacity: 0, duration: 0.45, ease: "power3.out" }, ${holdStart.toFixed(2)});
  tl.from(".role", { clipPath: "inset(0 100% 0 0)", opacity: 0, duration: 0.55, ease: "power2.out" }, ${(holdStart + 0.1).toFixed(2)});`,
  });
}

/** Centered pill badge with a finite pulse — LIVE, SALE, NEW… */
function badge(opts) {
  const { line1, line2, width, duration } = opts;
  const s = Math.min(width, 1920) / 1920;
  return compose(opts, {
    defaultEnter: 'pop', defaultExit: 'pop',
    css: `
  .scene { display:flex; flex-direction:column; justify-content:center; align-items:center;
    width:100%; height:100%; padding:${Math.round(120 * s)}px; gap:${Math.round(22 * s)}px;
    box-sizing:border-box; text-align:center; }
  .pill { display:inline-block; background:var(--accent); color:#0d0d12; font-size:${Math.round(64 * s)}px;
    font-weight:800; line-height:1; padding:${Math.round(30 * s)}px ${Math.round(64 * s)}px;
    border-radius:${Math.round(80 * s)}px; box-shadow:0 12px 48px rgba(0,0,0,.35); max-width:85%; }
  .caption { font-size:${Math.round(36 * s)}px; font-weight:500; margin:0; color:#fff; text-shadow:0 2px 16px rgba(0,0,0,.5); }`,
    body: `    <div class="scene">
      <div class="pill">${esc(line1)}</div>
      ${line2 ? `<p class="caption">${esc(line2)}</p>` : ''}
    </div>`,
    flourish: ({ holdStart, holdEnd }) => {
      const win = Math.max(0.6, holdEnd - holdStart - 0.2);
      return `  tl.from(".caption", { y: 22, opacity: 0, duration: 0.45, ease: "power2.out" }, ${holdStart.toFixed(2)});
  tl.to(".pill", { scale: 1.05, duration: 0.6, ease: "sine.inOut", repeat: ${repeatsFor(win, 1.2)}, yoyo: true }, ${holdStart.toFixed(2)});`;
    },
  });
}

/** Full-width news lower third with a logo bug, LIVE tag + ticker strip. */
function newsLowerThird(opts) {
  const { line1, line2, width } = opts;
  const s = Math.min(width, 1920) / 1920;
  const logo = opts.logoText ? String(opts.logoText).slice(0, 6) : monogram(line1);
  return compose(opts, {
    defaultEnter: 'swipe-up', defaultExit: 'swipe-down',
    css: `
  .news { position:absolute; left:0; right:0; bottom:${Math.round(70 * s)}px;
    display:flex; align-items:stretch; gap:${Math.round(2 * s)}px;
    margin:0 ${Math.round(70 * s)}px; height:${Math.round(150 * s)}px;
    filter:drop-shadow(0 12px 34px rgba(0,0,0,.45)); }
  .bug { flex:0 0 auto; display:flex; align-items:center; justify-content:center;
    min-width:${Math.round(150 * s)}px; padding:0 ${Math.round(24 * s)}px; background:var(--accent);
    color:#0b0b0f; font-weight:800; font-size:${Math.round(52 * s)}px; line-height:1;
    border-radius:${Math.round(8 * s)}px 0 0 ${Math.round(8 * s)}px; letter-spacing:.02em; }
  .ncol { flex:1 1 auto; display:flex; flex-direction:column; background:rgba(11,11,15,.92);
    border-radius:0 ${Math.round(8 * s)}px ${Math.round(8 * s)}px 0; overflow:hidden; }
  .ntop { flex:1 1 auto; display:flex; align-items:center; gap:${Math.round(20 * s)}px;
    padding:0 ${Math.round(34 * s)}px; }
  .live { display:inline-flex; align-items:center; gap:${Math.round(9 * s)}px; flex:0 0 auto;
    background:#e0263a; color:#fff; font-weight:800; font-size:${Math.round(22 * s)}px;
    letter-spacing:.12em; padding:${Math.round(7 * s)}px ${Math.round(14 * s)}px; border-radius:${Math.round(5 * s)}px; }
  .dot { width:${Math.round(10 * s)}px; height:${Math.round(10 * s)}px; border-radius:50%; background:#fff; }
  .nhead { margin:0; color:#fff; font-weight:700; font-size:${Math.round(46 * s)}px; line-height:1.05;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ticker { flex:0 0 auto; height:${Math.round(42 * s)}px; display:flex; align-items:center;
    padding:0 ${Math.round(34 * s)}px; background:var(--accent); color:#0b0b0f; overflow:hidden; }
  .ticker span { font-weight:600; font-size:${Math.round(24 * s)}px; letter-spacing:.03em; white-space:nowrap; }`,
    body: `    <div class="news">
      <div class="bug">${esc(logo)}</div>
      <div class="ncol">
        <div class="ntop">
          <span class="live"><span class="dot"></span>LIVE</span>
          <h2 class="nhead">${esc(line1)}</h2>
        </div>
        ${line2 ? `<div class="ticker"><span>${esc(line2)}</span></div>` : ''}
      </div>
    </div>`,
    flourish: ({ holdStart, holdEnd }) => {
      const win = Math.max(0.6, holdEnd - holdStart - 0.2);
      return `  tl.from(".bug", { rotationY: 90, opacity: 0, transformOrigin: "left center", duration: 0.55, ease: "power3.out" }, ${(holdStart - 0.1).toFixed(2)});
  tl.from(".nhead", { clipPath: "inset(0 100% 0 0)", opacity: 0, duration: 0.6, ease: "power2.out" }, ${(holdStart + 0.1).toFixed(2)});
  tl.from(".ticker span", { x: 40, opacity: 0, duration: 0.5, ease: "power2.out" }, ${(holdStart + 0.25).toFixed(2)});
  tl.to(".dot", { opacity: 0.15, duration: 0.5, ease: "power1.inOut", repeat: ${repeatsFor(win, 1.0)}, yoyo: true }, ${holdStart.toFixed(2)});`;
    },
  });
}

/** RGB-split glitch headline — fun, energetic, techy. */
function glitchTitle(opts) {
  const { line1, line2, width } = opts;
  const s = Math.min(width, 1920) / 1920;
  const j = Math.round(8 * s);
  return compose(opts, {
    defaultEnter: 'zoom', defaultExit: 'fade', defaultFont: 'anton',
    css: `
  .scene { display:flex; flex-direction:column; justify-content:center; align-items:center;
    width:100%; height:100%; padding:${Math.round(120 * s)}px; gap:${Math.round(30 * s)}px;
    box-sizing:border-box; text-align:center; }
  .gwrap { position:relative; }
  .gh { margin:0; font-size:${Math.round(140 * s)}px; font-weight:800; line-height:1; letter-spacing:.01em;
    text-transform:uppercase; }
  .gh.base { position:relative; color:#fff; text-shadow:0 4px 30px rgba(0,0,0,.5); }
  .gh.gr, .gh.gb { position:absolute; inset:0; mix-blend-mode:screen; }
  .gh.gr { color:var(--accent); }
  .gh.gb { color:var(--secondary); }
  .gsub { margin:0; color:#fff; opacity:.85; font-size:${Math.round(38 * s)}px; font-weight:500;
    letter-spacing:.34em; text-transform:uppercase; }`,
    body: `    <div class="scene">
      <div class="gwrap">
        <h1 class="gh base">${esc(line1)}</h1>
        <h1 class="gh gr" aria-hidden="true">${esc(line1)}</h1>
        <h1 class="gh gb" aria-hidden="true">${esc(line1)}</h1>
      </div>
      ${line2 ? `<p class="gsub">${esc(line2)}</p>` : ''}
    </div>`,
    flourish: ({ holdStart, holdEnd }) => {
      const win = Math.max(0.6, holdEnd - holdStart - 0.2);
      const rep = repeatsFor(win, 0.9);
      return `  tl.from(".gsub", { y: 18, opacity: 0, duration: 0.5, ease: "power2.out" }, ${holdStart.toFixed(2)});
  tl.set(".gr", { x: -${j}, y: ${Math.round(j / 2)} }, ${holdStart.toFixed(2)});
  tl.set(".gb", { x: ${j}, y: -${Math.round(j / 2)} }, ${holdStart.toFixed(2)});
  tl.to(".gr", { x: ${j}, y: -${Math.round(j / 2)}, duration: 0.09, ease: "steps(2)", repeat: ${rep * 5}, yoyo: true }, ${holdStart.toFixed(2)});
  tl.to(".gb", { x: -${j}, y: ${Math.round(j / 2)}, duration: 0.11, ease: "steps(2)", repeat: ${rep * 4}, yoyo: true }, ${holdStart.toFixed(2)});
  tl.to(".base", { skewX: 6, duration: 0.06, ease: "steps(1)", repeat: 1, yoyo: true }, ${(holdStart + 0.4).toFixed(2)});
  tl.to(".base", { skewX: -5, duration: 0.06, ease: "steps(1)", repeat: 1, yoyo: true }, ${(holdStart + win / 2).toFixed(2)});`;
    },
  });
}

/** Elegant cinematic title: wide-tracked serif between two thin rules. */
function cinematicTitle(opts) {
  const { line1, line2, width } = opts;
  const s = Math.min(width, 1920) / 1920;
  return compose(opts, {
    defaultEnter: 'fade', defaultExit: 'fade', defaultFont: 'playfair',
    css: `
  .scene { display:flex; flex-direction:column; justify-content:center; align-items:center;
    width:100%; height:100%; padding:${Math.round(150 * s)}px; gap:${Math.round(34 * s)}px;
    box-sizing:border-box; text-align:center; }
  .kicker { margin:0; color:var(--accent); font-size:${Math.round(30 * s)}px; font-weight:600;
    letter-spacing:.5em; text-transform:uppercase; padding-left:.5em; }
  .chead { margin:0; color:#fff; font-size:${Math.round(120 * s)}px; font-weight:700; line-height:1.08;
    letter-spacing:.02em; text-shadow:0 4px 30px rgba(0,0,0,.5); max-width:92%; }
  .cruleT, .cruleB { width:${Math.round(200 * s)}px; height:${Math.max(1, Math.round(2 * s))}px; background:var(--accent); opacity:.9; }`,
    body: `    <div class="scene">
      <div class="cruleT"></div>
      ${line2 ? `<p class="kicker">${esc(line2)}</p>` : ''}
      <h1 class="chead">${esc(line1)}</h1>
      <div class="cruleB"></div>
    </div>`,
    // Tracking is held statically (animating letter-spacing reflows/snaps text
    // under frame capture); the reveal comes from transforms only.
    flourish: ({ holdStart }) => `  tl.from(".cruleT", { scaleX: 0, duration: 0.7, ease: "power2.inOut" }, ${(holdStart - 0.1).toFixed(2)});
  tl.from(".cruleB", { scaleX: 0, duration: 0.7, ease: "power2.inOut" }, ${(holdStart - 0.1).toFixed(2)});
  tl.from(".kicker", { opacity: 0, y: -14, duration: 0.7, ease: "power2.out" }, ${holdStart.toFixed(2)});
  tl.from(".chead", { opacity: 0, y: 22, scale: 1.04, duration: 0.9, ease: "power3.out" }, ${(holdStart + 0.1).toFixed(2)});`,
  });
}

/** Glowing neon sign with a flicker. */
function neonSign(opts) {
  const { line1, line2, width } = opts;
  const s = Math.min(width, 1920) / 1920;
  return compose(opts, {
    defaultEnter: 'pop', defaultExit: 'fade', defaultFont: 'righteous',
    css: `
  .scene { display:flex; flex-direction:column; justify-content:center; align-items:center;
    width:100%; height:100%; padding:${Math.round(120 * s)}px; gap:${Math.round(28 * s)}px;
    box-sizing:border-box; text-align:center; }
  .neon { margin:0; color:#fff; font-size:${Math.round(130 * s)}px; font-weight:400; line-height:1.05;
    letter-spacing:.02em; --n:1;
    text-shadow:0 0 calc(6px*var(--n)) #fff, 0 0 calc(16px*var(--n)) var(--accent),
      0 0 calc(38px*var(--n)) var(--accent), 0 0 calc(70px*var(--n)) var(--accent); }
  .ncap { margin:0; color:var(--accent); font-size:${Math.round(40 * s)}px; font-weight:500;
    letter-spacing:.3em; text-transform:uppercase;
    text-shadow:0 0 12px var(--accent); }`,
    body: `    <div class="scene">
      <h1 class="neon">${esc(line1)}</h1>
      ${line2 ? `<p class="ncap">${esc(line2)}</p>` : ''}
    </div>`,
    flourish: ({ holdStart, holdEnd }) => {
      const win = Math.max(0.6, holdEnd - holdStart - 0.2);
      return `  tl.from(".ncap", { y: 18, opacity: 0, duration: 0.5, ease: "power2.out" }, ${holdStart.toFixed(2)});
  tl.set(".neon", { "--n": 0.2 }, ${holdStart.toFixed(2)});
  tl.to(".neon", { "--n": 1, duration: 0.12, ease: "steps(2)", repeat: 3, yoyo: true }, ${holdStart.toFixed(2)});
  tl.to(".neon", { "--n": 1.25, duration: 1.1, ease: "sine.inOut", repeat: ${repeatsFor(win, 1.1)}, yoyo: true }, ${(holdStart + 0.5).toFixed(2)});`;
    },
  });
}

export const TEMPLATES = {
  'kinetic-title': kineticTitle,
  'lower-third': lowerThird,
  badge,
  'news-lower-third': newsLowerThird,
  'glitch-title': glitchTitle,
  'cinematic-title': cinematicTitle,
  'neon-sign': neonSign,
};

/** Valid ids for the animation knobs — imported by the server for validation. */
export const ENTER_IDS = ['auto', 'pop', 'fade', 'zoom', 'bounce', 'flip', 'blur', 'swipe-left', 'swipe-right', 'swipe-up', 'swipe-down'];
export const EXIT_IDS = ['auto', 'none', 'pop', 'fade', 'zoom', 'flip', 'blur', 'swipe-left', 'swipe-right', 'swipe-up', 'swipe-down'];
export const BORDER_IDS = ['none', 'glow', 'draw', 'marching', 'gradient', 'corners'];
export const FONT_IDS = ['auto', ...Object.keys(FONTS)];

/** Split a prompt into headline + subtitle: newline or "|" wins, else first
 * sentence boundary, else the whole prompt is the headline. */
export function splitPrompt(prompt) {
  const t = String(prompt).trim();
  const hard = t.split(/\r?\n|\|/).map(s => s.trim()).filter(Boolean);
  if (hard.length >= 2) return { line1: hard[0], line2: hard.slice(1).join(' · ') };
  const m = t.match(/^(.{4,80}?[.!?])\s+(.+)$/s);
  if (m) return { line1: m[1].replace(/[.!?]$/, ''), line2: m[2].trim() };
  return { line1: t, line2: '' };
}

/** Render a named template to composition HTML. */
export function buildTemplate(name, params) {
  const fn = TEMPLATES[name];
  if (!fn) throw new Error(`Unknown template "${name}"`);
  const { line1, line2 } = splitPrompt(params.prompt);
  return fn({
    line1: line1.slice(0, 90),
    line2: line2.slice(0, 120),
    width: params.width, height: params.height, duration: params.duration,
    transparent: params.format === 'webm',
    accent: params.accentColor || '#06b4e0',
    secondary: params.secondaryColor || '#ffffff',
    enter: params.enter, exit: params.exit, font: params.font,
    border: params.border, logoText: params.logoText,
  });
}
