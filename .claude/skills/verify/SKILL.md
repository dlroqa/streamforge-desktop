---
name: verify
description: Build, launch, and drive StreamForge (Vite + React + Supabase) to verify changes at the browser surface.
---

# Verifying StreamForge changes

## Build / launch
- Dev server: `npm run dev` → http://localhost:8080 (port fixed in vite.config.ts).
- Typecheck `npx tsc --noEmit`; tests `npx vitest run`; prod build `npx vite build`.

## Auth gotcha (the main hurdle)
Every interesting route (`/`, `/editor`) is behind ProtectedRoute (Supabase auth).
Email signup requires confirmation, so you can't mint a real session headlessly.
Workaround that works: inject a fake session into localStorage key
`sb-uhrfardkdinwcxshlqlo-auth-token` — supabase-js accepts any well-formed
session with a future `expires_at` (build an unsigned JWT with base64url
header/payload). The UI renders; all Supabase server calls 401/403 gracefully
(empty recordings, failed meta loads) which is fine for UI-wiring checks.

## Driving the browser
No Playwright in the repo. Install it in the scratchpad (`npm i playwright &&
npx playwright install chromium`) and drive headless. Useful entry points:
- Editor timeline toolbar buttons are `button[title^="..."]` (e.g. `title^="Add music"`).
- Dialogs/Sheets are `[role="dialog"]` — use `.last()` when stacked.
- Mock third-party APIs (Freesound, Suno resolver) with `page.route()` to
  drive logged-in/search flows without real credentials.
- Freesound login state: localStorage `freesound.tokens`
  (`{accessToken,refreshToken,expiresAt}`) — set it to fake a connected account.

## What can't be driven locally
- Supabase edge functions (deployed via user-run CLI only) — calls to
  undeployed functions fail CORS/404; client code should degrade gracefully.
- Real OAuth popups (Freesound, Twitch/YouTube/Facebook) — need registered
  credentials + deployed functions.
