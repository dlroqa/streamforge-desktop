#!/usr/bin/env node
/**
 * One-time upload of the ffmpeg.wasm single-threaded core into the public
 * Supabase `models` bucket, so the browser can fetch it by URL. Run once per
 * project (re-run after bumping @ffmpeg/core):
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run upload:ffmpeg
 *
 * WHY Supabase and not a bundled asset: the core is ~32 MB, over Cloudflare
 * Workers' 25 MiB per-asset limit, so it can't ship in dist/. It's hosted on
 * our own Supabase infra (permissive CORS, not on Brave's block lists) and
 * loaded via toBlobURL (a plain cross-origin fetch, like the ASR model files) —
 * see src/lib/stabilize.ts and whisperConfig.ts. Files land at models/ffmpeg/.
 */
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const BUCKET = 'models';
const CORE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'node_modules', '@ffmpeg', 'core', 'dist', 'esm',
);
const FILES = [
  { name: 'ffmpeg-core.js', type: 'text/javascript' },
  { name: 'ffmpeg-core.wasm', type: 'application/wasm' },
];

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log(`Uploading ffmpeg.wasm core to ${SUPABASE_URL} bucket "${BUCKET}/ffmpeg"\n`);
  for (const { name, type } of FILES) {
    const bytes = await readFile(path.join(CORE_DIR, name));
    const { error } = await supabase.storage.from(BUCKET).upload(`ffmpeg/${name}`, bytes, {
      contentType: type, upsert: true,
    });
    if (error) throw new Error(`${name}: ${error.message}`);
    console.log(`  ✓ ffmpeg/${name} (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)`);
  }
  console.log(`\nDone. Stabilization loads the core from:\n  ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/ffmpeg/`);
}

main().catch((e) => { console.error('\nUpload failed:', e.message); process.exit(1); });
