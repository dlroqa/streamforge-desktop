// StreamForge Desktop — Electron main process.
//
// Responsibilities:
//   1. Serve the built SPA from a fixed http://localhost:8080 origin (prod) or
//      point at the Vite dev server (dev) — a stable origin keeps OAuth working.
//   2. Grant the media / display-capture permissions the studio needs.
//   3. Answer getDisplayMedia with a native source picker (screen share).
//   4. Let OAuth popups open as real child windows (opener + postMessage relay)
//      while sending ordinary external links to the system browser.
import {
  app,
  BrowserWindow,
  session,
  desktopCapturer,
  shell,
  ipcMain,
  Menu,
  nativeImage,
} from "electron";
import path from "node:path";
import { startStaticServer, type StaticServer } from "./staticServer";
import { checkForUpdates, initUpdater, RELEASES_PAGE } from "./updater";

const isDev = process.env.ELECTRON_DEV === "1";
const DEV_URL = "http://localhost:8080";
const PREFERRED_PORT = 8080;

// Providers whose consent pages we allow to open in the OAuth child window.
// The final hop always lands back on our own origin (/oauth/callback).
const OAUTH_HOSTS = [
  "accounts.google.com",
  "oauth2.googleapis.com",
  "id.twitch.tv",
  "www.facebook.com",
  "facebook.com",
  "www.youtube.com",
  "appleid.apple.com",
  "github.com",
  "login.microsoftonline.com",
];

let mainWindow: BrowserWindow | null = null;
let staticServer: StaticServer | null = null;
let appOrigin = DEV_URL;

/** Grant exactly the permissions the studio relies on; deny everything else. */
function configurePermissions(): void {
  const allowed = new Set([
    "media", // camera + microphone (getUserMedia)
    "display-capture", // screen share (getDisplayMedia)
    "audioCapture",
    "videoCapture",
    "notifications",
    "clipboard-read",
    "clipboard-sanitized-write",
    "fullscreen",
  ]);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    allowed.has(permission),
  );

  // getDisplayMedia → show a native picker of screens + windows. `useSystemPicker`
  // is honored on macOS/Windows builds that support it; the desktopCapturer
  // callback is the cross-platform fallback (and the only path on Linux).
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 320, height: 180 },
          fetchWindowIcons: true,
        });
        const chosen = await pickSource(sources);
        if (!chosen) return callback({}); // user cancelled
        callback({ video: chosen, audio: "loopback" });
      } catch {
        callback({});
      }
    },
    { useSystemPicker: true },
  );
}

/** Open a modal picker window and resolve with the chosen desktop source. */
function pickSource(
  sources: Electron.DesktopCapturerSource[],
): Promise<Electron.DesktopCapturerSource | null> {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      parent: mainWindow ?? undefined,
      modal: true,
      width: 760,
      height: 560,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: "Choose what to share",
      backgroundColor: "#0d0f17",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    picker.setMenuBarVisibility(false);

    const payload = sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }));

    let settled = false;
    const finish = (id: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!picker.isDestroyed()) picker.close();
      resolve(id ? sources.find((s) => s.id === id) ?? null : null);
    };
    const onChoose = (_e: unknown, id: string) => finish(id);
    const onList = (e: Electron.IpcMainEvent) =>
      e.sender.send("picker:sources", payload);
    const cleanup = () => {
      ipcMain.removeListener("picker:choose", onChoose);
      ipcMain.removeListener("picker:ready", onList);
    };

    ipcMain.on("picker:choose", onChoose);
    ipcMain.on("picker:ready", onList);
    picker.on("closed", () => finish(null));
    picker.loadFile(path.join(__dirname, "picker.html"));
  });
}

/** Allow OAuth popups as real child windows; send other links to the OS browser. */
function configureWindowOpen(wc: Electron.WebContents): void {
  wc.setWindowOpenHandler(({ url, frameName }) => {
    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      /* not a parseable URL */
    }
    const isOAuthPopup =
      frameName === "streamforge-oauth" ||
      url.startsWith(appOrigin) ||
      OAUTH_HOSTS.some((h) => host === h || host.endsWith("." + h));

    if (isOAuthPopup) {
      // Real child window: preserves window.opener so OAuthCallback.tsx can
      // postMessage the auth code back to the studio (same-origin check passes
      // once it redirects to appOrigin/oauth/callback).
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 600,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    // Everything else (docs, marketing links) opens outside the app.
    shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });
}

// ── Startup splash ───────────────────────────────────────────────────────
// A frameless, transparent window shown instantly at launch (before the static
// server even boots) so the cold-start wait feels intentional. It bridges the
// whole load and crossfades into the login. See electron/splash.html.
let splashWindow: BrowserWindow | null = null;
let splashShownAt = 0;
let revealed = false;
// Minimum time the splash stays up (the real hold is max(this, load time), so a
// slow cold start still stays covered). Platform-independent — 6s on macOS,
// Windows and Linux alike.
const MIN_SPLASH_MS = 6000;

// Opt-in lifecycle tracing (mirrors SF_UPDATER_DEBUG). Set SF_SPLASH_DEBUG=1.
const splashLog = (msg: string): void => {
  if (process.env.SF_SPLASH_DEBUG)
    // eslint-disable-next-line no-console
    console.log(`[splash] +${Date.now() - (splashShownAt || Date.now())}ms ${msg}`);
};

function createSplash(): void {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 340,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: true,
    center: true,
    alwaysOnTop: true,
    show: false,
    // No preload/Node — the splash is inert HTML/CSS.
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.webContents.on("did-fail-load", (_e, code, desc) =>
    splashLog(`did-fail-load ${code} ${desc}`),
  );
  splashWindow.once("ready-to-show", () => {
    splashShownAt = Date.now();
    splashLog("shown");
    splashWindow?.show();
  });
  splashWindow.on("closed", () => {
    splashWindow = null;
    splashLog("closed");
  });
}

/** Show the main window once loaded, holding + crossfading the splash. */
function revealMainWindow(): void {
  if (revealed || !mainWindow) return;
  revealed = true;

  const elapsed = splashShownAt ? Date.now() - splashShownAt : MIN_SPLASH_MS;
  const wait = Math.max(0, MIN_SPLASH_MS - elapsed);
  splashLog(`main ready; holding ${wait}ms more`);

  setTimeout(() => {
    if (!mainWindow) return;
    mainWindow.show();
    splashLog("main shown, fading splash");
    fadeOutSplash();
  }, wait);
}

/** Window-level opacity crossfade, then destroy — no IPC/preload needed. */
function fadeOutSplash(): void {
  const splash = splashWindow;
  if (!splash || splash.isDestroyed()) return;

  let opacity = 1;
  const step = () => {
    if (splash.isDestroyed()) return;
    opacity -= 0.08;
    if (opacity <= 0) {
      splash.close();
      return;
    }
    splash.setOpacity(opacity);
    setTimeout(step, 16); // ~450ms total
  };
  step();
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#0d0f17",
    show: false,
    title: "StreamForge",
    icon: process.platform === "linux" ? getLinuxIcon() : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  configureWindowOpen(mainWindow.webContents);
  // Reveal is deferred so the splash can bridge the whole load with no flash.
  mainWindow.once("ready-to-show", () => revealMainWindow());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(isDev ? DEV_URL : appOrigin);
  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
}

function getLinuxIcon(): Electron.NativeImage | undefined {
  const p = path.join(__dirname, "..", "build", "icon.png");
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? undefined : img;
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";

  // "Check for Updates…" belongs directly under About on macOS, which means
  // spelling out the app menu instead of using role: "appMenu".
  const checkForUpdatesItem: Electron.MenuItemConstructorOptions = {
    id: "check-for-updates",
    label: "Check for Updates…",
    click: () => void checkForUpdates(true),
  };

  const appMenu: Electron.MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      checkForUpdatesItem,
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        // Windows/Linux have no app menu, so this is the only route to the
        // updater there; harmless duplication on macOS.
        ...(isMac ? [] : [checkForUpdatesItem, { type: "separator" as const }]),
        {
          label: "Releases",
          click: () => void shell.openExternal(RELEASES_PAGE),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Single-instance lock: focus the existing window instead of opening a second.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Splash first, before the (awaited) static-server boot, so it appears
    // immediately and covers the slowest part of startup.
    createSplash();

    if (!isDev) {
      staticServer = await startStaticServer(
        path.join(__dirname, "..", "dist"),
        PREFERRED_PORT,
      );
      appOrigin = staticServer.origin;
    }
    configurePermissions();
    buildMenu();
    initUpdater();

    ipcMain.handle("app:getVersion", () => app.getVersion());

    await createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", async () => {
    await staticServer?.close();
  });
}
