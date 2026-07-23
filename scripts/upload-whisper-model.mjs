#!/usr/bin/env node
/**
 * One-time upload of the teleprompter's on-device voice model + ONNX runtime
 * into the public Supabase `models` bucket. Run once per project:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run upload:model
 *
 * (SUPABASE_URL falls back to VITE_SUPABASE_URL. The service-role key is your
 * secret Supabase key — never ship it to the browser; it's only used here.)
 *
 * It downloads the quantized Moonshine files from Hugging Face (this runs on
 * your machine/CI, not in Brave, so the HF fetch is fine) and copies the ONNX
 * runtime wasm from node_modules, then uploads everything to the bucket at the
 * paths the app expects:
 *   models/onnx-community/moonshine-base-ONNX/...  and  models/ort/...
 *
 * Keep MODEL in sync with ASR_MODEL in src/lib/whisperConfig.ts. Previously
 * uploaded models (Xenova/whisper-tiny.en) are left in the bucket, so rolling
 * back is just reverting ASR_MODEL — no re-upload needed.
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
const MODEL = 'onnx-community/moonshine-base-ONNX';
const HF_BASE = `https://huggingface.co/${MODEL}/resolve/main`;

// Files the transformers.js ASR pipeline needs for dtype 'q8' on WASM.
// (Moonshine's repo has no vocab.json/merges.txt/normalizer.json/
// added_tokens.json — everything lives in tokenizer.json.)
const MODEL_FILES = [
  'config.json', 'generation_config.json', 'preprocessor_config.json',
  'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];
// ONNX runtime (single-thread jsep build) — copied from the installed package.
const ORT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'node_modules', 'onnxruntime-web', 'dist',
);
const ORT_FILES = ['ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs'];

function contentType(name) {
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.onnx')) return 'application/octet-stream';
  if (name.endsWith('.wasm')) return 'application/wasm';
  if (name.endsWith('.mjs')) return 'text/javascript';
  return 'application/octet-stream';
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function put(destPath, bytes) {
  const { error } = await supabase.storage.from(BUCKET).upload(destPath, bytes, {
    contentType: contentType(destPath), upsert: true,
  });
  if (error) throw new Error(`${destPath}: ${error.message}`);
  console.log(`  ✓ ${destPath} (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
}

async function main() {
  console.log(`Uploading ASR model (${MODEL}) + runtime to ${SUPABASE_URL} bucket "${BUCKET}"\n`);

  console.log('Model files (from Hugging Face):');
  for (const f of MODEL_FILES) {
    const res = await fetch(`${HF_BASE}/${f}`);
    if (!res.ok) throw new Error(`download ${f}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await put(`${MODEL}/${f}`, bytes);
  }

  console.log('\nONNX runtime (from node_modules):');
  for (const f of ORT_FILES) {
    const bytes = await readFile(path.join(ORT_DIR, f));
    await put(`ort/${f}`, bytes);
  }

  console.log(`\nDone. The teleprompter will load the model from:\n  ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${MODEL}/`);
}

main().catch((e) => { console.error('\nUpload failed:', e.message); process.exit(1); });
