/// <reference lib="webworker" />
// On-device speech recognition worker. Runs the ASR model (Moonshine, via
// transformers.js — see whisperConfig.ts) off the main thread so continuous
// transcription never competes with the render / broadcast loop. Loaded lazily — transformers.js and the ONNX runtime are
// imported ONLY here, so they code-split into this worker's bundle and never
// bloat the main app.
//
// Protocol (main → worker):
//   { type: 'load', model, device }        → load the model (emits 'progress', then 'ready' | 'error')
//   { type: 'transcribe', id, audio }      → transcribe a 16 kHz mono Float32 chunk (emits 'text')
// (worker → main): 'progress' | 'ready' | 'error' | 'text'

import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { MODELS_BASE } from './whisperConfig';

// Serve the MODEL from our own Supabase Storage (public bucket), never from the
// Hugging Face hub — that cross-origin CDN fetch is blocked by Brave Shields /
// strict CSPs ("TypeError: Failed to fetch"). Supabase is our own
// infrastructure (permissive CORS, not on Brave's block lists). Model files are
// uploaded once via `npm run upload:model`.
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.remoteHost = MODELS_BASE;            // e.g. https://<proj>.supabase.co/storage/v1/object/public/models/
env.remotePathTemplate = '{model}/';     // → <base>onnx-community/moonshine-base-ONNX/<file>
// Force single-threaded WASM. Multi-threaded onnxruntime-web needs
// SharedArrayBuffer, which requires the page to be cross-origin isolated
// (COOP/COEP headers) — this app isn't, so threaded init would fail. Single
// thread works everywhere without special headers.
env.backends.onnx.wasm.numThreads = 1;
// Do NOT override wasm.wasmPaths: transformers.js + Vite bundle the ONNX
// runtime .wasm as a SAME-ORIGIN asset (/assets/ort-...wasm), which Brave never
// blocks. Pointing it at a cross-origin host (Supabase) is what previously
// failed to load — so we leave the bundled same-origin path in place.

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let loading = false;

type LoadMsg = { type: 'load'; model: string; device: 'webgpu' | 'wasm' };
type TranscribeMsg = { type: 'transcribe'; id: number; audio: Float32Array };
type InMsg = LoadMsg | TranscribeMsg;

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;

  if (msg.type === 'load') {
    if (transcriber || loading) return;
    loading = true;
    try {
      transcriber = await pipeline('automatic-speech-recognition', msg.model, {
        device: msg.device,
        // q8 for BOTH providers so WebGPU reuses the same weights already in the
        // Supabase bucket (no extra fp16/fp32 upload, no bucket-limit bump). If
        // the WebGPU EP can't run the quantized ops it throws → engine falls back
        // to WASM. (The larger fp16 weights would be needed for peak GPU speed.)
        dtype: 'q8',
        progress_callback: (p: unknown) => {
          const prog = p as { status?: string; progress?: number };
          if (prog?.status === 'progress' && typeof prog.progress === 'number') {
            self.postMessage({ type: 'progress', progress: prog.progress });
          }
        },
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err) });
    } finally {
      loading = false;
    }
    return;
  }

  if (msg.type === 'transcribe') {
    if (!transcriber) return;
    try {
      // Moonshine is English-only; no language/task options needed.
      const out = await transcriber(msg.audio);
      const text = Array.isArray(out) ? out.map(o => o.text).join(' ') : out.text;
      self.postMessage({ type: 'text', id: msg.id, text: text ?? '' });
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err), id: msg.id });
    }
  }
};
