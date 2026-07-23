#!/usr/bin/env node
// HyperFrames motion-graphics render service for StreamForge.
//
// POST /generate  { prompt, mode, template?, format?, width?, height?,
//                   duration?, fps?, accentColor? }        -> 202 { jobId }
// GET  /jobs/:id                                           -> job status
// GET  /renders/:id.(webm|mp4)                             -> the rendered file
// GET  /health                                             -> { ok, llm, ... }
//
// Template mode fills a built-in parameterized composition (templates.mjs);
// LLM mode has Claude author one (llm.mjs, needs ANTHROPIC_API_KEY). Either
// way the composition is linted then rendered with `npx hyperframes render`
// (headless Chrome + FFmpeg), one job at a time — renders are heavy.
//
// Env: PORT (8791), ALLOW_ORIGIN (*), JOBS_DIR (./jobs),
//      ANTHROPIC_API_KEY (optional — enables LLM mode),
//      HYPERFRAMES_MODEL (claude-opus-4-8)
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { buildTemplate, TEMPLATES, ENTER_IDS, EXIT_IDS, BORDER_IDS, FONT_IDS } from './templates.mjs';
import { llmAvailable, authorComposition, repairComposition } from './llm.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8791);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const JOBS_DIR = process.env.JOBS_DIR || join(ROOT, 'jobs');
const BUILD = 'hf-2026-07-12-2';
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const RENDER_TIMEOUT_MS = 5 * 60 * 1000;

// Memory-constrained hosts (e.g. Render starter, 512MB): drop quality and/or
// cap the output pixel count — Chrome capture + the encoder scale with the
// frame size, and an OOM kill loses the whole in-memory job table.
const RENDER_QUALITY = ['draft', 'standard', 'high'].includes(process.env.RENDER_QUALITY)
  ? process.env.RENDER_QUALITY : 'standard';
const MAX_RENDER_PIXELS = Number(process.env.MAX_RENDER_PIXELS) || 0; // 0 = unlimited

/** Scale a requested size down (keeping aspect, even dims) to fit the cap. */
function fitToPixelCap(width, height) {
  if (!MAX_RENDER_PIXELS || width * height <= MAX_RENDER_PIXELS) return { width, height };
  const k = Math.sqrt(MAX_RENDER_PIXELS / (width * height));
  const even = (n) => Math.max(2, 2 * Math.floor((n * k) / 2));
  return { width: even(width), height: even(height) };
}

const SIZES = new Set(['1920x1080', '1080x1920', '1080x1080']);
const CTYPE = { webm: 'video/webm', mp4: 'video/mp4' };
const ENTER_SET = new Set(ENTER_IDS);
const EXIT_SET = new Set(EXIT_IDS);
const BORDER_SET = new Set(BORDER_IDS);
const FONT_SET = new Set(FONT_IDS);

/** In-memory job table; the rendered files live on disk under JOBS_DIR. */
const jobs = new Map();
const queue = [];
let working = false;
let doctorOk = null; // null = still checking

// ---------------------------------------------------------------- helpers

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limit = 100_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Run `npx hyperframes <args>` in a job dir; resolve {code, out}. */
function runCli(args, cwd, timeoutMs = RENDER_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['--no-install', 'hyperframes', ...args], {
      cwd, env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const cap = (c) => { out += c; if (out.length > 200_000) out = out.slice(-100_000); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
    child.on('error', err => { clearTimeout(timer); resolve({ code: 1, out: String(err) }); });
  });
}

/** Extract error entries from `lint --json` / `validate --json` output. */
function lintErrors(out) {
  try {
    const start = out.indexOf('{'); const alt = out.indexOf('[');
    const idx = start === -1 ? alt : (alt === -1 ? start : Math.min(start, alt));
    if (idx === -1) return null;
    const data = JSON.parse(out.slice(idx));
    const items = Array.isArray(data) ? data : (data.issues || data.errors || data.findings || []);
    const errs = items.filter(i => (i.severity || i.level || 'error') === 'error');
    return errs.length ? errs.map(e => `- ${e.message || e.msg || JSON.stringify(e)}`).join('\n') : null;
  } catch {
    return null; // unparseable output — rely on the exit code instead
  }
}

// ---------------------------------------------------------------- pipeline

function setStatus(job, status, progress) {
  job.status = status;
  job.progress = progress;
}

async function processJob(job) {
  const dir = join(JOBS_DIR, job.id);
  const p = job.params;
  try {
    await mkdir(join(dir, 'renders'), { recursive: true });

    // 1. Author the composition
    setStatus(job, 'authoring', 0.15);
    let html, llmMessages = null;
    if (p.mode === 'llm') {
      const authored = await authorComposition(p);
      html = authored.html;
      llmMessages = authored.messages;
    } else {
      html = buildTemplate(p.template, p);
    }
    await writeFile(join(dir, 'index.html'), html, 'utf8');

    // 2. Lint — with one LLM repair round on errors
    setStatus(job, 'validating', 0.35);
    let lint = await runCli(['lint', '--json'], dir, 60_000);
    if (lint.code !== 0) {
      const errs = lintErrors(lint.out) || lint.out.slice(-1500);
      if (p.mode === 'llm' && llmMessages) {
        html = await repairComposition({ messages: llmMessages, html, errors: errs, ...p });
        await writeFile(join(dir, 'index.html'), html, 'utf8');
        lint = await runCli(['lint', '--json'], dir, 60_000);
        if (lint.code !== 0) {
          throw new Error(`Composition failed lint after repair:\n${lintErrors(lint.out) || lint.out.slice(-800)}`);
        }
      } else {
        // Template output is pre-verified — a lint failure here is a server bug.
        throw new Error(`Template composition failed lint (server bug):\n${errs}`);
      }
    }

    // 3. Render
    setStatus(job, 'rendering', 0.55);
    const outFile = `renders/out.${p.format}`;
    const render = await runCli([
      'render', '--output', outFile, '--format', p.format,
      '--fps', String(p.fps), '--quality', RENDER_QUALITY,
    ], dir);
    const outPath = join(dir, outFile);
    if (render.code !== 0 || !existsSync(outPath)) {
      throw new Error(`Render failed:\n${render.out.slice(-1200)}`);
    }

    job.result = {
      url: `/renders/${job.id}.${p.format}`,
      format: p.format, width: p.width, height: p.height, duration: p.duration,
    };
    setStatus(job, 'done', 1);
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    setStatus(job, 'error', 1);
  }
}

async function pump() {
  if (working) return;
  const job = queue.shift();
  if (!job) return;
  working = true;
  try { await processJob(job); } finally {
    working = false;
    void pump();
  }
}

// ---------------------------------------------------------------- validation

function parseGenerate(body) {
  let data;
  try { data = JSON.parse(body || '{}'); } catch { throw new Error('Invalid JSON body'); }

  const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : '';
  if (!prompt) throw new Error('Missing "prompt"');
  if (prompt.length > 2000) throw new Error('Prompt too long (max 2000 chars)');

  const mode = data.mode === 'llm' ? 'llm' : 'template';
  if (mode === 'llm' && !llmAvailable()) {
    throw new Error('AI mode is unavailable: the service has no ANTHROPIC_API_KEY configured.');
  }

  const template = data.template || 'kinetic-title';
  if (mode === 'template' && !TEMPLATES[template]) {
    throw new Error(`Unknown template "${template}" — use one of: ${Object.keys(TEMPLATES).join(', ')}`);
  }

  const format = data.format === 'mp4' ? 'mp4' : 'webm';
  let width = Number(data.width) || 1920;
  let height = Number(data.height) || 1080;
  if (!SIZES.has(`${width}x${height}`)) {
    throw new Error('Unsupported size — use 1920x1080, 1080x1920, or 1080x1080');
  }
  ({ width, height } = fitToPixelCap(width, height));
  const duration = Math.min(15, Math.max(2, Number(data.duration) || 5));
  const fps = [24, 30, 60].includes(Number(data.fps)) ? Number(data.fps) : 30;

  const hex = (v, name) => {
    if (v == null) return undefined;
    if (!/^#[0-9a-fA-F]{6}$/.test(String(v))) throw new Error(`${name} must be a #rrggbb hex value`);
    return String(v);
  };
  const accentColor = hex(data.accentColor, 'accentColor');
  const secondaryColor = hex(data.secondaryColor, 'secondaryColor');

  // Animation / style knobs (all optional; 'auto' = template default).
  const pick = (v, set, name) => {
    if (v == null) return undefined;
    if (!set.has(String(v))) throw new Error(`Unknown ${name} "${v}"`);
    return String(v);
  };
  const enter = pick(data.enter, ENTER_SET, 'enter');
  const exit = pick(data.exit, EXIT_SET, 'exit');
  const border = pick(data.border, BORDER_SET, 'border');
  const font = pick(data.font, FONT_SET, 'font');

  let logoText;
  if (data.logoText != null) {
    logoText = String(data.logoText).replace(/[\r\n]+/g, ' ').trim().slice(0, 24);
  }

  return {
    prompt, mode, template, format, width, height, duration, fps,
    accentColor, secondaryColor, enter, exit, border, font, logoText,
  };
}

// ---------------------------------------------------------------- server

const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && (path === '/health' || path === '/')) {
    return sendJson(res, 200, {
      ok: true, build: BUILD, node: process.version,
      llm: llmAvailable(), doctor: doctorOk, queued: queue.length, working,
      quality: RENDER_QUALITY, maxPixels: MAX_RENDER_PIXELS,
    });
  }

  if (req.method === 'POST' && path === '/generate') {
    let params;
    try {
      params = parseGenerate(await readBody(req));
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const job = { id: randomUUID(), status: 'queued', progress: 0, params, createdAt: Date.now() };
    jobs.set(job.id, job);
    queue.push(job);
    void pump();
    return sendJson(res, 202, { jobId: job.id });
  }

  const jobMatch = path.match(/^\/jobs\/([0-9a-f-]{36})$/);
  if (req.method === 'GET' && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) return sendJson(res, 404, { error: 'Unknown job' });
    return sendJson(res, 200, {
      id: job.id, status: job.status, progress: job.progress,
      error: job.error, result: job.result,
    });
  }

  const renderMatch = path.match(/^\/renders\/([0-9a-f-]{36})\.(webm|mp4)$/);
  if (req.method === 'GET' && renderMatch) {
    const [, id, ext] = renderMatch;
    const file = join(JOBS_DIR, id, 'renders', `out.${ext}`);
    if (!existsSync(file)) return sendJson(res, 404, { error: 'Render not found' });
    cors(res);
    res.writeHead(200, {
      'Content-Type': CTYPE[ext],
      'Content-Length': statSync(file).size,
      'Content-Disposition': `inline; filename="motion-graphic.${ext}"`,
    });
    return createReadStream(file).pipe(res);
  }

  sendJson(res, 404, { error: 'not found' });
});

// Reap stale job dirs from previous runs, then confirm the render toolchain.
async function startup() {
  await mkdir(JOBS_DIR, { recursive: true });
  try {
    for (const name of await readdir(JOBS_DIR)) {
      const dir = join(JOBS_DIR, name);
      const s = await stat(dir).catch(() => null);
      if (s?.isDirectory() && Date.now() - s.mtimeMs > JOB_TTL_MS) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  } catch { /* best effort */ }

  // First `npx hyperframes` run may download headless Chrome — do it now so
  // the first job doesn't eat the cost. Doctor exits non-zero when OPTIONAL
  // extras (whisper/TTS/Docker) are missing, so readiness is judged on the
  // render essentials instead: FFmpeg + a usable Chrome.
  const doctor = await runCli(['doctor'], ROOT, 10 * 60 * 1000);
  doctorOk = /✓\s+FFmpeg/.test(doctor.out) && /✓\s+Chrome/.test(doctor.out);
  console.log(`hyperframes doctor: ${doctorOk ? 'render toolchain ok' : 'MISSING ESSENTIALS'}${doctorOk ? '' : `\n${doctor.out.slice(-800)}`}`);
}

server.listen(PORT, () => {
  console.log(`HyperFrames render service on :${PORT} (origin ${ALLOW_ORIGIN}) — LLM mode ${llmAvailable() ? 'enabled' : 'disabled (set ANTHROPIC_API_KEY)'}`);
  void startup();
});
