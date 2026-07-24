# StreamForge

A live streaming studio — multistream to YouTube, Twitch, Facebook and custom
RTMP with guests, overlays, unified chat, an in-app video editor and an
on-device teleprompter.

This repository is both the **web app** (Vite + React + shadcn/ui + Supabase)
and a **desktop app** (Electron) for macOS (Apple Silicon + Intel), Windows, and
Ubuntu 24+. The desktop app runs the exact same UI as the web version, wrapped in
Chromium so WebRTC, screen capture, `ffmpeg.wasm` and the on-device ASR behave
identically on every OS.

## Desktop app

The desktop shell lives in [`electron/`](electron/) and serves the built web
bundle from a fixed local origin (`http://localhost:8080`) inside an Electron
window. That fixed origin is intentional: StreamForge's OAuth flow derives its
redirect URIs and validates its popup messages against `window.location.origin`,
so the desktop app reuses the same origin the dev server uses.

### Run in development

```sh
npm install
npm run electron:dev      # Vite dev server + Electron, hot-reloading
```

### Run the production build locally

```sh
npm run electron:start    # vite build → bundle electron → launch
```

### Package installers

```sh
npm run dist:mac          # → release/  (.dmg + .zip, arm64 + x64)
npm run dist:win          # → release/  (.exe NSIS installer, x64 + arm64)
npm run dist:linux        # → release/  (.AppImage + .deb, x64)
npm run dist              # all targets the current OS can build
```

Build each platform's installer **on that platform** (or in CI): macOS `.dmg`
requires macOS; Windows `.exe` builds best on Windows. Linux artifacts build on
Ubuntu 24+. The `Build desktop installers` GitHub Actions workflow does all
three on native runners — push a `v*` tag and it attaches them to a Release.

### Installing the unsigned macOS build

Builds ship **unsigned** (no Apple Developer certificate). The app bundle is
*ad-hoc* signed during packaging — required, or Apple Silicon refuses to launch
an arm64 binary at all — but macOS still quarantines anything downloaded from
the internet. On first run:

- **Right-click** the app in Applications → **Open** → **Open** in the dialog, or
- clear the quarantine flag:
  ```sh
  xattr -cr /Applications/StreamForge.app
  ```

Windows SmartScreen will likewise warn: **More info → Run anyway**.

To ship properly signed and notarized builds, add the `CSC_LINK` (base64 `.p12`),
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`
repository secrets, map them into the packaging step in
[.github/workflows/build-desktop.yml](.github/workflows/build-desktop.yml), drop
`CSC_IDENTITY_AUTO_DISCOVERY`, and remove `identity: null` from
[electron-builder.yml](electron-builder.yml). See the
[electron-builder docs](https://www.electron.build/code-signing).

### One-time backend configuration

Because the desktop app's origin is `http://localhost:8080` (rather than the
hosted URL), register that origin with the services StreamForge talks to. You own
all of these:

- **Supabase → Authentication → URL Configuration** — add `http://localhost:8080`
  to the allowed **Redirect URLs**.
- **Each streaming platform's OAuth app** (Google/YouTube, Twitch, Facebook,
  LivePush, Google Drive) — add `http://localhost:8080/oauth/callback` as an
  authorized redirect URI.
- **`video-cut-resolver`** (Render, `render.yaml`) — add `http://localhost:8080`
  to its `ALLOW_ORIGIN` (or set `*`) so the editor's Video Cut tool isn't
  CORS-blocked. `hyperframes-service` already allows `*`.

### Known desktop limitations

- **Email magic-link / confirmation** links open in your default browser (at
  `localhost:8080`), not inside the Electron window — a standard limitation of
  desktop apps that use web OAuth. Password sign-in and the OAuth **popup** flows
  (platform connections) work fully inside the app.
- If port `8080` is already in use, the app falls back to a random free port and
  logs it; OAuth redirect URIs registered for `:8080` would then need that port
  too, so keep `8080` free when using platform connections.

### How it's wired (for maintainers)

| File | Role |
| --- | --- |
| [`electron/main.ts`](electron/main.ts) | App entry: static server, permission + display-media + window-open handlers, menu, single-instance lock |
| [`electron/preload.ts`](electron/preload.ts) | Minimal `contextBridge` (app version + screen-share picker channel) |
| [`electron/staticServer.ts`](electron/staticServer.ts) | Serves `dist/` on `http://localhost:8080` with SPA fallback |
| [`electron/picker.html`](electron/picker.html) | Native screen/window chooser for `getDisplayMedia` |
| [`electron/build.mjs`](electron/build.mjs) | esbuild bundler → `electron-dist/` |
| [`scripts/round-icon.py`](scripts/round-icon.py) | Regenerates `build/icon.png` with rounded corners from the source artwork |
| [`electron-builder.yml`](electron-builder.yml) | Packaging targets for mac/win/linux |

---

## Project info

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
