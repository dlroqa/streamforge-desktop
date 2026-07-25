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
| `dist:mac` / `dist:win` (need their own OS) | ✅ built in CI |
| Published to GitHub + v1.0.2 release, all 3 platforms | ✅ shipped |
| Rounded app icon (`scripts/round-icon.py`) | ✅ shipped in v1.0.1 |
| In-app "Check for Updates…" (`electron/updater.ts`) | ✅ shipped in v1.0.2 |

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

## Published — v1.0.2 is live

- **Source (private):** https://github.com/dlroqa/streamforge-desktop — branch `main`
- **Releases (PUBLIC, binaries only):** https://github.com/dlroqa/streamforge-releases
- **Latest:** v1.0.2 — mac arm64/Intel dmg+zip, Windows exe, Linux AppImage+deb

Two repos on purpose. The app repo is private, and a shipped app has no
credentials — GitHub's releases API returns **404** for a private repo, so the
in-app updater could never see a release there. The public repo hosts binaries
only; `electron-builder.yml`'s `publish:` block points at it and bakes
`app-update.yml` into the package.

Cross-repo publishing needs the **`RELEASES_TOKEN`** secret on the private repo
(a PAT with `contents: write` on streamforge-releases). The built-in
`GITHUB_TOKEN` is scoped to its own repo and cannot write across repos — there
is no way around this. Rotate with:
`gh secret set RELEASES_TOKEN --repo dlroqa/streamforge-desktop`

### Update feed — verified working
Fetched unauthenticated, exactly as the shipped app does: `latest.yml`,
`latest-mac.yml`, `latest-linux.yml` all return 200, and every file they
reference downloads (200). Re-check with the block in this file's git history
after any release.

### Bugs fixed in CI — do not regress these

1. **Never map absent signing secrets.** `CSC_LINK: ${{ secrets.CSC_LINK }}`
   with no such secret expands to an empty string; electron-builder reads
   CSC_LINK as a *path to a certificate* and fails with `<workspace> not a file`.
   Only `CSC_IDENTITY_AUTO_DISCOVERY: false` is set now.
2. **arm64 + x64 dmgs need distinct volume names.** They build concurrently; a
   shared `dmg.title` mounts both at `/Volumes/StreamForge`, so each one's
   `hdiutil detach` destroys the other's volume. Fixed with `${arch}` in the title.
3. **Windows runners default to PowerShell.** Any `run:` step using POSIX test
   syntax needs `shell: bash` or it dies with a ParserError. This silently
   shipped a v1.0.2 with no Windows exe *and no latest.yml*, i.e. no update feed
   for Windows, while the run still looked half-successful.

### macOS signing
Builds are **ad-hoc signed** by `electron/afterPack.cjs` — Apple Silicon refuses
to launch an arm64 binary with no signature at all. That is not notarization:
users clear quarantine once (`xattr -cr`) on first install.

Squirrel.Mac cannot apply an update to such a build — it verifies the new bundle
against the running app's designated requirement, which for an ad-hoc signature
is `cdhash H"…"`, a hash of the build itself. So `electron/macUpdater.ts` does
the install instead: download the arch-matched `.zip`, check its sha512 against
`latest-mac.yml`, `ditto -x -k` into a staging dir, then a detached script waits
for the app to exit, swaps the bundle (moving the old one aside so a failed copy
rolls back) and reopens it. No certificate involved anywhere.

Windows (silent NSIS) and Linux (AppImage self-swap, or `.deb` via
electron-updater's DebUpdater behind one polkit prompt) install and restart
through electron-updater as normal — also unsigned.

## Next steps

1. **Outstanding user action:** the one-time backend config (also in README
   "Desktop app"). Until it is done, platform connections fail in the desktop
   app: register `http://localhost:8080` in Supabase redirect URLs,
   `http://localhost:8080/oauth/callback` in each platform OAuth app, and widen
   `video-cut-resolver`'s `ALLOW_ORIGIN`.
2. Nobody has run the shipped installers on real macOS or Windows hardware yet —
   only Linux was smoke-tested locally. Worth a manual pass.
3. To cut a new version: bump `version` in **both** package.json and
   package-lock.json (CI uses `npm ci`, which fails if they disagree), commit,
   then tag `vX.Y.Z` and push the tag.
4. **The updater has never been exercised end-to-end.** CI proves the feed
   resolves, not that the app consumes it. Install the current version by hand
   on each OS, release the next one, then use Check for Updates… to confirm
   download/install/restart. Worth checking per platform, since all three now
   take different install paths (see "macOS signing" above). On macOS the swap
   script logs to `~/Library/Logs/StreamForge/update.log`; elsewhere run with
   `SF_UPDATER_DEBUG=1`.

## Known limitations to communicate

- Email magic-link / confirmation opens in the default browser, not the app.
- Installers are unsigned (Gatekeeper / SmartScreen warnings).
- mac/win installers must be built on their own OS (or CI); only Linux builds
  natively here.
