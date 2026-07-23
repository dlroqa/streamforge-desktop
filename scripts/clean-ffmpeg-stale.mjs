// Defensive pre-build cleanup. An earlier build step used to stage the ~32MB
// ffmpeg core into public/ffmpeg/ (now removed — the core is hosted on Supabase
// instead, see src/lib/stabilize.ts). That path is git-ignored, so on a CACHED
// CI workspace (e.g. Cloudflare Workers Builds) a stale copy can linger and get
// copied into dist/, blowing Cloudflare's 25 MiB per-asset limit ("Asset too
// large"). Removing it here guarantees a clean dist regardless of build cache.

import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['public/ffmpeg', 'dist/ffmpeg']) {
  rmSync(resolve(root, dir), { recursive: true, force: true });
}
