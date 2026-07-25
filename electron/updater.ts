// Auto-update: download → install → restart, sourced from the PUBLIC
// streamforge-releases repo (the app repo itself is private, so a shipped app
// could never read its releases — the API returns 404 without credentials).
//
// Wired to the "Check for Updates…" item in the StreamForge menu, and run once
// quietly a few seconds after launch.
//
// Every platform ends up in the same place — download, install, relaunch, with
// no code-signing certificate anywhere — but gets there differently:
//
//   Windows  electron-updater end to end. Unsigned NSIS installers self-apply
//            fine; SmartScreen only ever complains at first install.
//   Linux    electron-updater end to end, for both packages we ship. AppImage
//            swaps its own file; .deb goes through electron-updater's DebUpdater,
//            which raises one polkit prompt (writing to /opt needs root) and
//            installs with apt/dpkg. electron-builder lists both artifacts in
//            latest-linux.yml, so each install format finds its own.
//   macOS    electron-updater for the *check* only, then electron/macUpdater.ts
//            does the install, because Squirrel.Mac refuses to apply an update
//            to an ad-hoc signed build. See that file for the full explanation.
import { app, dialog, shell, Menu, BrowserWindow } from "electron";
import electronUpdater, { type UpdateInfo } from "electron-updater";
import {
  applyStagedUpdate,
  canInstallInPlace,
  discardStagedUpdate,
  hasStagedUpdate,
  stageUpdate,
} from "./macUpdater";

// electron-updater picks its Linux implementation from a `package-type` file in
// resources/, which the deb target writes into the *shared* linux-unpacked dir.
// Build the deb before the AppImage and that marker gets baked into the AppImage
// too, which would send AppImage users down the deb's install path. Ordering in
// electron-builder.yml currently avoids it; pinning the AppImage case here means
// a reordered target list can't quietly break it.
const autoUpdater = process.env.APPIMAGE
  ? new electronUpdater.AppImageUpdater()
  : electronUpdater.autoUpdater;

export const RELEASES_REPO = "https://github.com/dlroqa/streamforge-releases";
export const RELEASES_PAGE = `${RELEASES_REPO}/releases/latest`;
const RELEASES_DOWNLOAD = `${RELEASES_REPO}/releases/download`;

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

let checking = false;
/** Set when the user asked explicitly, so we can stay silent on background runs. */
let interactive = false;
/** Guards the quit-then-install handoff so it cannot re-enter itself. */
let quittingToInstall = false;

function configure(): void {
  autoUpdater.autoDownload = false; // ask first, then download
  autoUpdater.autoInstallOnAppQuit = true;
  // Silent by default. Set SF_UPDATER_DEBUG=1 to trace the check/download to
  // stdout — the only practical way to diagnose an updater problem on a user's
  // machine, since every failure path here is deliberately quiet.
  autoUpdater.logger = process.env.SF_UPDATER_DEBUG
    ? // eslint-disable-next-line no-console
      { info: console.log, warn: console.warn, error: console.error, debug: console.log }
    : null;
}

/** Show download progress where the OS already puts it: the dock/taskbar icon. */
function setProgress(fraction: number): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return;
  win.setProgressBar(fraction);
}

/** Last resort when we cannot install for them — hand off to the browser. */
async function offerManualDownload(version: string, reason: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "info",
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
    message: `StreamForge ${version} is available`,
    detail: `${reason}\n\nDownload it and drag it into Applications, replacing the current app.`,
  });
  if (response === 0) await shell.openExternal(RELEASES_PAGE);
}

/** Quit into the swap script. The script relaunches us if asked. */
async function finishInstall(relaunch: boolean): Promise<void> {
  quittingToInstall = true;
  await applyStagedUpdate(relaunch);
  app.quit();
}

/** Apply the staged update on quit instead, when the user picks "Later". */
function installOnQuit(): void {
  app.once("before-quit", (event) => {
    if (quittingToInstall || !hasStagedUpdate()) return;
    // The swap script has to be spawned before we go, and that is async, so
    // stop this quit and re-issue it once the handoff is done.
    event.preventDefault();
    void finishInstall(false);
  });
}

/**
 * macOS: download, verify and unpack the release ourselves, then swap the
 * bundle in on quit. Squirrel is never involved.
 */
async function runMacUpdate(info: UpdateInfo): Promise<void> {
  if (!(await canInstallInPlace())) {
    checking = false;
    await offerManualDownload(
      info.version,
      "StreamForge can't update itself from where it's installed — it needs " +
        "write access to its own app bundle, which it doesn't have when running " +
        "straight off the disk image or from an install owned by another user.",
    );
    return;
  }

  const { response } = await dialog.showMessageBox({
    type: "info",
    buttons: ["Install", "Later"],
    defaultId: 0,
    cancelId: 1,
    message: `StreamForge ${info.version} is available`,
    detail:
      `You're on ${app.getVersion()}. Download and install it now? ` +
      "The app will restart to finish up.",
  });
  if (response !== 0) {
    checking = false;
    return;
  }

  setMenuItemEnabled(false);
  try {
    await stageUpdate(info, RELEASES_DOWNLOAD, setProgress);
  } catch (err) {
    checking = false;
    setProgress(-1);
    setMenuItemEnabled(true);
    await discardStagedUpdate();
    const { response: pick } = await dialog.showMessageBox({
      type: "error",
      buttons: ["Open Releases", "OK"],
      defaultId: 1,
      cancelId: 1,
      message: "Update failed",
      detail:
        `${err instanceof Error ? err.message : String(err)}\n\n` +
        "Your current version is untouched.",
    });
    if (pick === 0) await shell.openExternal(RELEASES_PAGE);
    return;
  }

  checking = false;
  setProgress(-1);
  setMenuItemEnabled(true);

  const { response: restart } = await dialog.showMessageBox({
    type: "info",
    buttons: ["Restart Now", "Later"],
    defaultId: 0,
    cancelId: 1,
    message: `StreamForge ${info.version} is ready to install`,
    detail:
      "The app will close, swap in the new version and reopen. " +
      "If you choose Later it installs the next time you quit.",
  });
  if (restart === 0) await finishInstall(true);
  else installOnQuit();
}

function wire(): void {
  autoUpdater.on("update-available", async (info: UpdateInfo) => {
    if (isMac) {
      await runMacUpdate(info);
      return;
    }

    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `StreamForge ${info.version} is available`,
      detail:
        `You're on ${app.getVersion()}. Download it now? ` +
        "The app will restart to finish installing.",
    });
    if (response === 0) {
      setMenuItemEnabled(false);
      autoUpdater.downloadUpdate().catch(async (err: Error) => {
        checking = false;
        setProgress(-1);
        setMenuItemEnabled(true);
        await dialog.showMessageBox({
          type: "error",
          message: "Download failed",
          detail: `${err.message}\n\nYou can download it manually instead.`,
          buttons: ["OK"],
        });
      });
    } else {
      checking = false;
    }
  });

  autoUpdater.on("download-progress", (p: { percent: number }) => {
    setProgress(p.percent / 100);
  });

  autoUpdater.on("update-not-available", async () => {
    checking = false;
    if (!interactive) return; // stay quiet on the background check
    await dialog.showMessageBox({
      type: "info",
      message: "You're up to date",
      detail: `StreamForge ${app.getVersion()} is the latest version.`,
      buttons: ["OK"],
    });
  });

  // macOS never gets here — runMacUpdate owns the download and install there.
  autoUpdater.on("update-downloaded", async (info: UpdateInfo) => {
    checking = false;
    setProgress(-1);
    setMenuItemEnabled(true);
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `StreamForge ${info.version} is ready to install`,
      detail: isLinux
        ? "The app will close, install the update and reopen. If this is the " +
          ".deb install you'll be asked for your password, because it lives " +
          "under /opt. If you choose Later it installs the next time you quit."
        : "The app will close, install the update and reopen. " +
          "If you choose Later it installs the next time you quit.",
    });
    if (response === 0) {
      // isSilent so the NSIS installer runs unattended into the existing
      // location rather than walking the user back through its wizard;
      // isForceRunAfter relaunches us once it is done. Linux ignores isSilent.
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
    }
  });

  autoUpdater.on("error", async (err: Error) => {
    checking = false;
    setProgress(-1);
    setMenuItemEnabled(true);
    if (!interactive) return; // never nag on the background check
    await dialog.showMessageBox({
      type: "error",
      message: "Couldn't check for updates",
      detail: `${err.message}\n\nCheck the releases page for the newest build.`,
      buttons: ["OK"],
    });
  });
}

/**
 * Run an update check.
 * @param userInitiated true when triggered from the menu — surfaces
 *        "you're up to date" and error dialogs that the silent check suppresses.
 */
export async function checkForUpdates(userInitiated = false): Promise<void> {
  // In dev there is no app-update.yml and the version is Electron's own, so a
  // check is meaningless and just throws.
  if (!app.isPackaged) {
    if (userInitiated) {
      await dialog.showMessageBox({
        type: "info",
        message: "Updates aren't available in development",
        detail: "Run a packaged build to test the updater.",
        buttons: ["OK"],
      });
    }
    return;
  }

  // Already downloaded and waiting on a quit — offer that instead of re-checking.
  if (hasStagedUpdate()) {
    if (!userInitiated) return;
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: "An update is ready to install",
      detail: "The app will close, swap in the new version and reopen.",
    });
    if (response === 0) await finishInstall(true);
    return;
  }

  if (checking) return;
  checking = true;
  interactive = userInitiated;

  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    checking = false;
    if (userInitiated) {
      await dialog.showMessageBox({
        type: "error",
        message: "Couldn't check for updates",
        detail: String(err instanceof Error ? err.message : err),
        buttons: ["OK"],
      });
    }
  }
}

/** Enable/disable the menu item so a second check can't be started mid-flight. */
export function setMenuItemEnabled(enabled: boolean): void {
  const item = Menu.getApplicationMenu()?.getMenuItemById("check-for-updates");
  if (item) item.enabled = enabled;
}

export function initUpdater(): void {
  configure();
  wire();
  // Quiet check shortly after launch — late enough not to compete with startup.
  setTimeout(() => void checkForUpdates(false), 8000);
}
