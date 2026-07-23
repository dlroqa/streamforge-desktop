-- Public storage bucket for the teleprompter's on-device voice model + ONNX
-- runtime (Whisper). Public so the browser can fetch the weights by URL with no
-- auth; it's our own infrastructure (permissive CORS, not on Brave's block
-- lists), unlike the huggingface.co / jsdelivr CDNs which Brave Shields blocks.
-- Files are uploaded once via `npm run upload:model`.
--
-- These are large static assets (~44 MB model + ~21 MB runtime). Raising the
-- per-file size limit so the .onnx / .wasm objects are accepted.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('models', 'models', true, 78643200)  -- 75 MB
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 78643200;

-- Public buckets are world-readable through /object/public/<path>, so no SELECT
-- policy is needed. Uploads are performed with the service-role key (bypasses
-- RLS) by the one-time upload script, so no INSERT policy is needed either.
