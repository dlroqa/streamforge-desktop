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
  mainWindow.once("ready-to-show", () => mainWindow?.show());
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
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ role: "appMenu" as const }]
      : []),
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
    if (!isDev) {
      staticServer = await startStaticServer(
        path.join(__dirname, "..", "dist"),
        PREFERRED_PORT,
      );
      appOrigin = staticServer.origin;
    }
    configurePermissions();
    buildMenu();

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
