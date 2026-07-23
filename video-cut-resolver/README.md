# Video Cut resolver

The editor's **Video Cut** tool loads a video from an **X (Twitter)** or
**Facebook** link (plus direct `.mp4/.webm` URLs). Direct file
links are fetched by the browser; platform links can't be (CORS), so the front
end POSTs them to *this* service, which uses
[`yt-dlp`](https://github.com/yt-dlp/yt-dlp) to fetch the file and streams it back.

**YouTube and Rumble are intentionally not supported.** YouTube hard-blocks
datacenter IPs. Rumble sits behind Cloudflare, which 403s hosted downloaders on
IP reputation — in testing (2026-07), even TLS impersonation plus a proxy didn't
reliably clear it, so the front end rejects Rumble links up front.

> ⚠️ **Rights / ToS:** Only resolve videos you have the rights to. Downloading
> from these platforms may violate their Terms of Service. You operate this
> service; you're responsible for how it's used.

## API

`POST /  { "url": "https://x.com/…", "format": "mp4" | "webm" }`

Responds with the video as `video/mp4` or `video/webm` (default mp4), or JSON
`{ "error": "…" }` on failure. `GET /health` → JSON with the running build,
yt-dlp version, and whether `impersonate` is available (use it to confirm a
deploy actually landed).

`POST /suno { "url": "https://suno.com/s/… | /song/… | /playlist/…" }` → JSON
`{ ok, type, name, tracks: [{ id, title, audioUrl }] }`. Reads the PUBLIC Suno
page (short links redirect to a song; playlist pages embed their clips) and
returns track metadata. No Suno login — the browser fetches each `audioUrl`
(the Suno CDN sends `Access-Control-Allow-Origin: *`) itself. Song links are
resolved in the browser and never hit this endpoint.

`format` is a *preference*: each prefers same-container video+audio so the merge
is a stream-copy (no transcode). If the source has no webm, you get mp4 — the
response's `Content-Type` reflects what was actually produced, and the editor
handles either. ffmpeg (from the Dockerfile) does any mux.

## Why it can't run on Cloudflare / Supabase Edge

`yt-dlp` is a Python binary and needs `ffmpeg`; the edge runtimes (Workers,
Supabase Edge Functions / Deno Deploy) can't spawn arbitrary subprocesses. Run
this on a container/VM host instead: Render, Railway, Fly.io, or any box with
Docker.

## Deploy

```bash
# Local test
cd video-cut-resolver
# needs yt-dlp + ffmpeg on PATH, or just use Docker:
docker build -t video-cut-resolver .
docker run -p 8787:8787 -e ALLOW_ORIGIN="https://livepost-main.eddelaroca.workers.dev" video-cut-resolver
curl -X POST localhost:8787 -H 'Content-Type: application/json' -d '{"url":"https://x.com/…"}' --output out.mp4
```

Render/Railway/Fly: point the platform at this folder's `Dockerfile`, set
`ALLOW_ORIGIN` to your app's origin, and note the public URL it gives you.

### Env

| var | default | meaning |
|-----|---------|---------|
| `PORT` | `8787` | listen port |
| `ALLOW_ORIGIN` | `*` | CORS origin — set to your app's URL in production |
| `MAX_DURATION_SECONDS` | `3600` | reject videos longer than this |
| `YTDLP_IMPERSONATE` | `chrome` | browser TLS fingerprint to mimic (defeats Cloudflare 403s). `""` to disable, or e.g. `chrome-124` |
| `YTDLP_COOKIES_B64` | — | base64 of a `cookies.txt` (see below) — needed for login-gated X/Facebook content |
| `YTDLP_COOKIES_FILE` | — | path to a `cookies.txt` instead of the base64 var |
| `YTDLP_PROXY` | — | route yt-dlp through a proxy, e.g. `http://user:pass@host:port` |
| `YTDLP_EXTRA_ARGS` | — | extra raw yt-dlp args (advanced) |

## Cloudflare 403

`HTTP Error 403: Forbidden` on the *webpage* fetch means Cloudflare blocked the
request. There are two layers:

1. **TLS fingerprint** — handled by `--impersonate chrome` (on by default). This
   alone fixes the 403 from a **residential** IP.
2. **IP reputation** — Cloudflare also distrusts **datacenter** IPs (Render,
   Fly, etc.), so a hosted resolver can still 403 even with impersonation. The
   fix is to route through a **residential proxy** so the request comes from a
   home IP.

### Residential proxy setup (the datacenter-IP fix)

1. Get a **residential** proxy (not datacenter). Providers: Webshare, IPRoyal,
   Bright Data, Smartproxy — most give a `http://user:pass@host:port` endpoint.
2. In Render → your service → **Environment**, add a secret:
   `YTDLP_PROXY = http://USER:PASS@HOST:PORT`
3. Save (Render redeploys). Confirm with `GET /health` → `"proxy": true`, then
   retry. `/health` also shows `impersonate` and the running `build`.

A datacenter/free proxy won't help — Cloudflare distrusts those too. It must be
residential (or mobile). (This is also why Rumble support was dropped: in
testing, even a proxy didn't reliably clear Cloudflare's block there.)

## Auth (only if a platform blocks you)

**X (Twitter)** and **Facebook**
serve public videos fine, but some require a logged-in session, and datacenter
IPs occasionally get rate-limited. If you hit "login required" / "unavailable":

**Cookies:**
1. Log into the platform in a browser with a **throwaway** account (this can risk
   the account — don't use your main one).
2. Export cookies to `cookies.txt` (a "Get cookies.txt" browser extension).
3. Base64 it: `base64 -i cookies.txt | pbcopy` (macOS) and set it as the
   `YTDLP_COOKIES_B64` **secret** env var in Render. Redeploy.

**Proxy:** a residential proxy avoids datacenter-IP rate limits. Set `YTDLP_PROXY`.

These platforms change; a periodic `yt-dlp` update (rebuild the image) usually
fixes breakage.

## Wire the front end to it

Set the endpoint the app POSTs to (build-time Vite env), then rebuild/redeploy:

```bash
# .env.production
VITE_VIDEO_CUT_ENDPOINT="https://your-resolver.onrender.com"
```

Without this, `VITE_VIDEO_CUT_ENDPOINT` defaults to `/video-cut` (same origin),
which on the static host returns 405 — the tool will tell the user no resolver
is deployed. Direct video-file URLs keep working regardless.
