// Artifact download for the macOS updater, which fetches release assets itself
// rather than going through electron-updater's Squirrel-backed installer.
// Electron's `net` rather than node:https so system proxy settings and the OS
// certificate store are honoured, and redirect: follow because GitHub bounces
// release assets to a CDN.
import { net } from "electron";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";

/**
 * Download `url` to `dest`.
 * @returns the base64 sha512 of what actually landed, for the caller to check
 *          against the digest published alongside the release.
 */
export function download(
  url: string,
  dest: string,
  onProgress: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: "follow" });

    request.on("response", (response) => {
      if (response.statusCode >= 400) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }

      const header = response.headers["content-length"];
      const total = Number(Array.isArray(header) ? header[0] : header) || 0;
      let received = 0;

      const hash = createHash("sha512");
      const file = createWriteStream(dest);
      // pipe (rather than writing inside the data handler) so backpressure is
      // respected — these artifacts run to a couple of hundred megabytes.
      (response as unknown as NodeJS.ReadableStream).pipe(file);

      response.on("data", (chunk: Buffer) => {
        hash.update(chunk);
        received += chunk.length;
        if (total > 0) onProgress(received / total);
      });
      response.on("error", reject);
      file.on("error", reject);
      file.on("finish", () => resolve(hash.digest("base64")));
    });

    request.on("error", reject);
    request.end();
  });
}
