// In-app updates for macOS, without any Apple Developer certificate.
//
// electron-updater's macOS path hands the download to Squirrel.Mac, which
// refuses to install it: before swapping bundles Squirrel reads the *designated
// requirement* of the running app and demands the new bundle satisfy it. Our
// builds are ad-hoc signed (see electron/afterPack.cjs), so that requirement is
// `identifier "…" and cdhash H"…"` — a hash of the build itself, which by
// definition no other build can match. The download succeeds and the install
// always fails.
//
// So on macOS we skip Squirrel and do the install ourselves:
//
//   1. electron-updater still performs the *check* (plain HTTP against
//      latest-mac.yml — no Squirrel involved), and hands us an UpdateInfo.
//   2. We download the architecture-matched .zip straight from the public
//      releases repo and verify its sha512 against the one in latest-mac.yml.
//   3. `ditto -x -k` unpacks it into a staging dir (ditto, not unzip — it is
//      the only extractor that preserves the symlinks, permissions and nested
//      framework layout of an .app bundle intact).
//   4. A small detached script waits for us to quit, swaps the bundle, and
//      relaunches the app.
//
// No signature check happens anywhere in that chain, so an ad-hoc signed build
// updates itself normally. The sha512 from latest-mac.yml, served over TLS from
// the same release as the app, is what guarantees we install what we intended.
import { app } from "electron";
import { execFile, spawn } from "node:child_process";
import { constants as FS } from "node:fs";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { UpdateInfo } from "electron-updater";
import { download } from "./updateDownload";

const execFileAsync = promisify(execFile);

/** A downloaded, verified, unpacked bundle waiting to be swapped in. */
type StagedUpdate = {
  /** The extracted StreamForge.app inside the staging dir. */
  appPath: string;
  /** Staging dir to delete once the swap is done (or abandoned). */
  stageDir: string;
  /** Where the running bundle lives, i.e. what we are replacing. */
  targetPath: string;
  version: string;
};

let staged: StagedUpdate | null = null;

/**
 * The running .app bundle, derived from
 * `/Applications/StreamForge.app/Contents/MacOS/StreamForge`.
 * Null when running unpackaged, where there is no bundle to replace.
 */
export function currentBundlePath(): string | null {
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const cut = process.execPath.indexOf(marker);
  return cut === -1 ? null : process.execPath.slice(0, cut);
}

/**
 * Whether we can replace the bundle in place. False when the app was installed
 * for all users by an admin and we are not one, or when it is running from a
 * read-only mount (straight off the .dmg, which people do more often than you
 * would hope). Callers fall back to sending the user to the releases page.
 */
export async function canInstallInPlace(): Promise<boolean> {
  const bundle = currentBundlePath();
  if (!bundle) return false;
  try {
    // Both matter: we delete the bundle and create its replacement alongside.
    await access(bundle, FS.W_OK);
    await access(path.dirname(bundle), FS.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick the .zip matching the architecture we are running as, and work out where
 * to download it from. latest-mac.yml lists every mac artifact — both zips and
 * both dmgs — and the dmgs are useless to us here. Under Rosetta `process.arch`
 * is x64, which is what we want: an update should not silently switch the app's
 * architecture out from under the user.
 *
 * Exported for the unit tests; not part of the module's real surface.
 */
export function resolveAsset(
  info: UpdateInfo,
  downloadBase: string,
  arch: string = process.arch,
): { url: string; sha512: string } {
  const zips = (info.files ?? []).filter((f) => f.url.endsWith(".zip"));
  if (zips.length === 0) {
    throw new Error("That release has no macOS .zip to install from.");
  }
  const wantArm64 = arch === "arm64";
  const asset = zips.find((f) => /arm64/i.test(f.url) === wantArm64) ?? zips[0];

  // electron-builder tags releases as v<version> and latest-mac.yml carries the
  // bare asset name, but tolerate a provider that hands back an absolute URL.
  const url = /^https?:\/\//.test(asset.url)
    ? asset.url
    : `${downloadBase}/v${info.version}/${encodeURIComponent(asset.url)}`;

  return { url, sha512: asset.sha512 };
}

/**
 * Download, verify and unpack an update, leaving it staged for {@link applyStagedUpdate}.
 * Throws with a user-presentable message on any failure; nothing is touched
 * outside the staging dir, so a throw always leaves the installed app intact.
 */
export async function stageUpdate(
  info: UpdateInfo,
  downloadBase: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const targetPath = currentBundlePath();
  if (!targetPath) throw new Error("Could not locate the installed app bundle.");

  const { url, sha512: expected } = resolveAsset(info, downloadBase);

  const stageDir = await mkdtemp(path.join(os.tmpdir(), "streamforge-update-"));
  try {
    const zipPath = path.join(stageDir, "update.zip");
    const sha512 = await download(url, zipPath, onProgress);

    if (expected && sha512 !== expected) {
      throw new Error(
        "The downloaded update failed its integrity check and was discarded.",
      );
    }

    const unpackDir = path.join(stageDir, "unpacked");
    await mkdir(unpackDir, { recursive: true });
    // -x extract, -k treat the source as a zip archive.
    await execFileAsync("/usr/bin/ditto", ["-x", "-k", zipPath, unpackDir]);
    await rm(zipPath, { force: true });

    const bundle = (await readdir(unpackDir)).find((e) => e.endsWith(".app"));
    if (!bundle) throw new Error("The downloaded archive contained no app bundle.");

    staged = {
      appPath: path.join(unpackDir, bundle),
      stageDir,
      targetPath,
      version: info.version,
    };
  } catch (err) {
    await rm(stageDir, { recursive: true, force: true });
    throw err;
  }
}

/** True once {@link stageUpdate} has succeeded and a swap is pending. */
export function hasStagedUpdate(): boolean {
  return staged !== null;
}

/**
 * Hand the swap to a detached script. The script has to outlive us — a bundle
 * cannot replace itself while its own binary is the one running — so it waits
 * for this pid to exit before touching anything. The caller quits the app once
 * this resolves.
 *
 * @param relaunch reopen the app once the new bundle is in place.
 */
export async function applyStagedUpdate(relaunch: boolean): Promise<void> {
  const update = staged;
  if (!update) return;
  staged = null;

  const logPath = path.join(app.getPath("logs"), "update.log");
  // Outside stageDir: the script deletes that dir as part of its work.
  const scriptPath = path.join(
    await mkdtemp(path.join(os.tmpdir(), "streamforge-swap-")),
    "swap.sh",
  );
  await writeFile(scriptPath, SWAP_SCRIPT, { mode: 0o755 });

  spawn(
    "/bin/bash",
    [
      scriptPath,
      String(process.pid),
      update.targetPath,
      update.appPath,
      update.stageDir,
      relaunch ? "1" : "0",
      logPath,
    ],
    { detached: true, stdio: "ignore" },
  ).unref();
}

/** Throw away a staged update (used when the download is superseded or fails late). */
export async function discardStagedUpdate(): Promise<void> {
  const update = staged;
  staged = null;
  if (update) await rm(update.stageDir, { recursive: true, force: true });
}

// Moves the old bundle aside rather than deleting it, so a failed ditto can be
// rolled back instead of leaving the user with no app at all. Everything is
// logged to ~/Library/Logs/StreamForge/update.log — by the time this runs there
// is no UI left to report into.
const SWAP_SCRIPT = `#!/bin/bash
# StreamForge update swap. Written by electron/macUpdater.ts; deletes itself.
# Args: <pid> <target.app> <staged.app> <stage-dir> <relaunch 0|1> <log>
set -u

pid="$1"; target="$2"; staged="$3"; stage="$4"; relaunch="$5"; log="$6"

mkdir -p "$(dirname "$log")"
exec >>"$log" 2>&1
echo "--- $(date '+%Y-%m-%d %H:%M:%S') installing $staged -> $target"

# Wait for the app to exit, but give up rather than hang forever if the user
# cancelled the quit (an unsaved-changes prompt, say).
waited=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 0.2
  waited=$((waited + 1))
  if [ "$waited" -ge 300 ]; then
    echo "app still running after 60s; aborting"
    rm -rf "$stage"
    rm -f "$0"
    exit 1
  fi
done

backup="\${target}.sf-old-$$"
if ! mv "$target" "$backup"; then
  echo "could not move the old bundle aside; nothing changed"
  rm -rf "$stage"
  rm -f "$0"
  exit 1
fi

if /usr/bin/ditto "$staged" "$target"; then
  echo "installed ok"
  rm -rf "$backup"
  # Belt and braces: the new bundle inherits no quarantine flag from our own
  # download, but a stray one here would make macOS refuse to launch it.
  /usr/bin/xattr -dr com.apple.quarantine "$target" 2>/dev/null || true
else
  echo "ditto failed; rolling back to the previous version"
  rm -rf "$target"
  mv "$backup" "$target"
fi

rm -rf "$stage"
if [ "$relaunch" = "1" ]; then
  # -n forces a fresh instance; LaunchServices can still think the old pid is
  # alive for a moment and would otherwise just try to activate it.
  /usr/bin/open -n "$target"
fi
rm -f "$0"
exit 0
`;
