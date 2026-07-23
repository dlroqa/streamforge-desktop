# RESUME — StreamForge Desktop port

Handoff / restart point for the Electron desktop port of `dlroqa/livepost-main`.
If a session was cut off, start here.

## Goal

Turn the private web app `github.com/dlroqa/livepost-main` (product name
**StreamForge**) into a desktop app for **macOS (arm64 + Intel), Windows, and
Ubuntu 24**, staying as close to the web UI as possible.

**Decisions already made and approved by the user:**
- **Electron** (not Tauri) — Chromium gives identical WebRTC / screen capture /
  `ffmpeg.wasm` / on-device ASR behavior on all three OSes.
- **Bundle the frontend locally** (not a thin wrapper on the hosted site) — a
  real installable app, served from a fixed `http://localhost:8080` origin.

## What this repo is

`/home/agent/Repositories/StreamForge` = the full web app source copied from
`livepost-main` (fresh `git init`, no remote), **plus** a new Electron layer.
The web app source was **not modified** — only additive files plus small edits
to `package.json`, `.gitignore`, `eslint.config.js`, and `README.md`.

Upstream reference clone (read-only, for diffing):
`/tmp/claude-1000/-home-agent-Repositories-StreamForge/ed60b9d4-29b9-4992-9c4a-7e7a0f2f7c06/scratchpad/livepost-main`

## Status

| Step | State |
| --- | --- |
| Copy web source into repo + `git init` | ✅ done |
| `electron/` layer (main, preload, staticServer, picker, build) | ✅ done |
| `electron-builder.yml` + `build/` icons + mac entitlements | ✅ done |
| `package.json` (main/scripts/devDeps), README, .gitignore, eslint | ✅ done |
| `npm install` | ✅ done |
| `npm run build` (Vite) | ✅ passes |
| `npm run electron:build` (esbuild) | ✅ passes |
| Electron launches; static server + SPA fallback verified | ✅ verified |
| `npm run lint` (0 errors) / `npm test` (76/76 pass) | ✅ passes |
| `npm run dist:linux` (AppImage 110MB + deb 76MB) | ✅ built |
| Packaged app boots; renderer reaches `/auth` via CDP | ✅ verified |
| `dist:mac` / `dist:win` (need their own OS) | ⬜ untested here |
| Nothing committed or pushed to GitHub | ⬜ by design — ask user first |

## Key architecture facts (re-derived at cost, don't lose these)

1. **Why a local HTTP server, not `file://` or `app://`:** StreamForge's OAuth
   derives redirect URIs from `window.location.origin` and its popup relays the
   auth code back with a strict `e.origin === window.location.origin` check
   (`src/lib/platformConnect.ts`, `src/pages/OAuthCallback.tsx`). An opaque
   origin breaks both. Hence `electron/staticServer.ts` on a fixed `:8080`.
2. **No COOP/COEP needed.** `public/_headers` sets none, `src/lib/asrWorker.ts`
   forces `numThreads=1`, and `src/lib/stabilize.ts` uses the single-threaded
   `@ffmpeg/core`. The app deliberately avoids SharedArrayBuffer, so the shell
   needs no cross-origin-isolation headers.
3. **Backends are already hosted** — Supabase (`uhrfardkdinwcxshlqlo`), Render
   sidecars (`hyperframes-service`, `video-cut-resolver`), Whisper model in
   Supabase Storage. `.env.production` is committed with publishable creds.
   No backend work is part of this port.
4. **Screen share** goes through `setDisplayMediaRequestHandler` +
   `desktopCapturer` + `electron/picker.html`. **OAuth popups** must be allowed
   as real child windows in `setWindowOpenHandler` so `window.opener` survives.

## Environment gotcha (cost real time — remember this)

`ELECTRON_RUN_AS_NODE=1` is set globally in this sandbox. It makes the Electron
binary run as plain Node, so `require('electron')` returns a **path string** and
`app` is `undefined` (`Cannot read properties of undefined (reading
'requestSingleInstanceLock')`). Always launch with it unset, and headless:

```sh
env -u ELECTRON_RUN_AS_NODE xvfb-run -a node_modules/.bin/electron . --no-sandbox
```

Also: the root `package.json` is `"type": "module"`, so `electron/build.mjs`
writes `electron-dist/package.json` = `{"type":"commonjs"}` to keep the bundled
CJS output loadable. Don't delete that.

**Kill stale instances before re-testing.** The app takes a single-instance
lock, so a leftover Electron from an earlier run keeps port 8080 and silently
makes a new launch quit — and any `curl localhost:8080` then tests the *old*
process. Clean up first:
`pkill -9 -f "node_modules/electron/dist/electron"; pkill -9 -f streamforge-desktop`

**`electron-builder.yml` must keep `- "!node_modules/**/*"`.** Vite already
inlines every runtime dep into `dist/`; without that exclusion the asar goes
26MB → 388MB and the AppImage 110MB → 468MB.

To confirm the React app really mounted (not just that files are served), launch
with `--remote-debugging-port=9222` and check the renderer URL — an
unauthenticated boot should land on `http://localhost:8080/auth`:
`curl -s http://localhost:9222/json | grep '"url"'`

## Commands

```sh
npm install
npm run electron:dev     # Vite + Electron, hot reload
npm run electron:start   # prod build, run locally
npm run dist:linux       # AppImage + deb → release/
npm run dist:mac         # .dmg + .zip (run on macOS)
npm run dist:win         # NSIS .exe (run on Windows)
```

## Publishing — BLOCKED on GitHub auth (do this first)

Everything is committed on branch `main` (commit `9cf4352`). Publishing is the
only step left, and it is blocked: the `gh` token went **invalid mid-session**
(`gh api user` → 401). There are no fallback credentials — no `GH_TOKEN`, no
credential helper, no SSH key.

User-approved plan (confirmed 2026-07-23): **new repo `dlroqa/streamforge-desktop`,
PRIVATE, plus a `v1.0.0` tag** so CI builds all three platforms and publishes a
Release. Do **not** push into `livepost-main` — it is Lovable-synced and pushes
there can collide with Lovable's auto-commits.

```sh
# 1. Re-authenticate. The `workflow` scope is required or the push will be
#    rejected for containing .github/workflows/build-desktop.yml.
gh auth login -h github.com -s repo,workflow

# 2. Create the private repo and push.
cd /home/agent/Repositories/StreamForge
gh repo create dlroqa/streamforge-desktop --private --source=. --remote=origin --push

# 3. Tag to trigger the all-platform build + Release.
git tag v1.0.0 && git push origin v1.0.0

# 4. Watch it.
gh run watch
```

The tag build is what produces the **macOS and Windows** installers — they
cannot be built on this Linux box (Windows needs wine; macOS needs the
darwin-only `dmg-license`). Both were attempted and failed for exactly those
reasons. Linux artifacts already exist in `release/` (AppImage 110MB, deb 76MB).

## Next steps

1. Run `npm run lint` and `npm test` to confirm the copied source is intact.
2. Run `npm run dist:linux`, then launch the AppImage and smoke-test.
3. Tell the user the one-time backend config (also in README "Desktop app"):
   register `http://localhost:8080` in Supabase redirect URLs,
   `http://localhost:8080/oauth/callback` in each platform OAuth app, and widen
   `video-cut-resolver`'s `ALLOW_ORIGIN`.
4. Ask before creating/pushing any GitHub repo.

## Known limitations to communicate

- Email magic-link / confirmation opens in the default browser, not the app.
- Installers are unsigned (Gatekeeper / SmartScreen warnings).
- mac/win installers must be built on their own OS (or CI); only Linux builds
  natively here.
