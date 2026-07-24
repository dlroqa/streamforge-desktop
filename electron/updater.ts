// Auto-update: download → install → restart, sourced from the PUBLIC
// streamforge-releases repo (the app repo itself is private, so a shipped app
// could never read its releases — the API returns 404 without credentials).
//
// Wired to the "Check for Updates…" item in the StreamForge menu, and run once
// quietly a few seconds after launch.
//
// macOS caveat: Squirrel.Mac verifies the code signature before applying an
// update, and our builds are only ad-hoc signed (no Apple Developer
// certificate). The download succeeds but the install step fails. Rather than
// dying with a cryptic error we detect that and fall back to opening the
// release page so the user can install the .dmg by hand. Ship a properly signed
// build and the normal path takes over with no code change.
import { app, dialog, shell, Menu } from "electron";
import electronUpdater, { type UpdateInfo } from "electron-updater";

const { autoUpdater } = electronUpdater;

export const RELEASES_PAGE =
  "https://github.com/dlroqa/streamforge-releases/releases/latest";

/** macOS builds are ad-hoc signed, so Squirrel cannot self-apply an update. */
const MAC_CANNOT_SELF_INSTALL = process.platform === "darwin";

let checking = false;
/** Set when the user asked explicitly, so we can stay silent on background runs. */
let interactive = false;

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

/** Offer the manual route when we cannot install for them. */
async function offerManualDownload(version: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "info",
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
    message: `StreamForge ${version} is available`,
    detail:
      "This build isn't signed with an Apple Developer certificate, so macOS " +
      "won't let it update itself. Download the new version and drag it into " +
      "Applications, replacing the current app.",
  });
  if (response === 0) await shell.openExternal(RELEASES_PAGE);
}

function wire(): void {
  autoUpdater.on("update-available", async (info: UpdateInfo) => {
    if (MAC_CANNOT_SELF_INSTALL) {
      checking = false;
      await offerManualDownload(info.version);
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
      autoUpdater.downloadUpdate().catch(async (err: Error) => {
        checking = false;
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

  autoUpdater.on("update-downloaded", async (info: UpdateInfo) => {
    checking = false;
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `StreamForge ${info.version} is ready to install`,
      detail:
        "The app will restart to apply the update. " +
        "If you choose Later it installs the next time you quit.",
    });
    if (response === 0) {
      // isSilent=false so the installer UI shows; isForceRunAfter relaunches us.
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    }
  });

  autoUpdater.on("error", async (err: Error) => {
    checking = false;
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
