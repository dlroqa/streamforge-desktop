// Single source of truth for where the on-device ASR model + ONNX runtime
// live. Hosted in a PUBLIC Supabase Storage bucket ("models") — our own
// infrastructure, so it isn't blocked by Brave Shields / CSPs the way the
// Hugging Face / jsdelivr CDNs are. Upload the files once with
// `npm run upload:model` (scripts/upload-whisper-model.mjs).

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;

/** Public base URL for the `models` bucket, with trailing slash. */
export const MODELS_BASE = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/models/`
  : '/models/'; // dev/local fallback (public/models/) if Supabase URL is unset

/**
 * The ASR model repo id (folder inside the bucket). Moonshine (Useful Sensors)
 * replaces whisper-tiny.en: unlike Whisper — which zero-pads every input to
 * 30 s, wasting ~95% of encoder compute on our ~1.4 s rolling windows —
 * Moonshine processes variable-length audio natively (~5× faster on short
 * clips) and moonshine-base has lower WER than whisper-tiny AND whisper-base.
 * Rollback: revert this id to 'Xenova/whisper-tiny.en' (files still in bucket).
 */
export const ASR_MODEL = 'onnx-community/moonshine-base-ONNX';

/** URL of a small model file, used as a cheap reachability preflight. */
export const MODEL_PROBE_URL = `${MODELS_BASE}${ASR_MODEL}/config.json`;
