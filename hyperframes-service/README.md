# HyperFrames render service

Turns a text prompt into a motion graphic for StreamForge's **Motion Graphics**
panel (Studio) and toolbar menu (Video Editor). Compositions are authored as
[HyperFrames](https://hyperframes.heygen.com) HTML — either from built-in
templates or by Claude — and rendered to video with headless Chrome + FFmpeg.

## Requirements

- Node.js >= 22
- FFmpeg on PATH
- ~1 GB free disk (first run downloads a headless Chrome build)

## Setup

```bash
cd hyperframes-service
npm install
npx hyperframes doctor    # verify Chrome/FFmpeg/Node are usable
npm start                 # listens on :8791
```

The app reaches it at `/hyperframes`, which the Vite dev server proxies to
`http://localhost:8791` (see `vite.config.ts`) — so it works even when the
browser only has a forwarded port to the app. Override the browser-side URL
with `VITE_HYPERFRAMES_ENDPOINT` in the project `.env`, or the proxy's
upstream with `HYPERFRAMES_UPSTREAM` when starting the dev server.

## Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8791` | Listen port |
| `ALLOW_ORIGIN` | `*` | CORS origin for the app |
| `ANTHROPIC_API_KEY` | — | Enables **AI mode** (Claude authors the composition). Without it only template mode works; `/health` reports `llm: false` and the app greys out the AI tab. |
| `HYPERFRAMES_MODEL` | `claude-opus-4-8` | Model for AI mode |
| `JOBS_DIR` | `./jobs` | Working dir for compositions + renders (reaped after 24 h) |

## API

- `POST /generate` — body `{ prompt, mode: "template"|"llm", template?, format?: "webm"|"mp4", width?, height?, duration?, fps?, accentColor? }` → `202 { jobId }`
- `GET /jobs/:id` → `{ status: queued|authoring|validating|rendering|done|error, progress, error?, result? }`
- `GET /renders/:id.webm` (or `.mp4`) → the rendered file
- `GET /health` → `{ ok, llm, doctor, queued, working }`

Templates: `kinetic-title`, `lower-third`, `badge`. Prompt text is split into
headline/subtitle on a newline or `|` (e.g. `Jane Doe | Lead Engineer`).

Default output is **WebM with an alpha channel** — the graphic composites
transparently over the stream/timeline. MP4 has no alpha (opaque backdrop is
added automatically). Note Safari cannot decode VP9 alpha; the StreamForge
capture pipeline targets Chromium, where it works.

Renders run one at a time (each spawns Chrome); extra requests queue.

## Smoke test

```bash
curl -s -X POST localhost:8791/generate -H 'Content-Type: application/json' \
  -d '{"prompt":"Big Sale | 50% off everything","mode":"template","template":"kinetic-title"}'
# poll: curl -s localhost:8791/jobs/<jobId>
# then: curl -sO localhost:8791/renders/<jobId>.webm
ffprobe -v error -select_streams v -show_entries stream=pix_fmt:stream_tags=alpha_mode -of csv=p=0 renders.webm
# expect "yuv420p,1" — VP9 alpha lives in a sidecar stream signalled by the
# ALPHA_MODE=1 tag (pix_fmt alone reads as opaque; Chromium honors the tag)
```
