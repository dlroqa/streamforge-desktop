// Covers the pure decisions in the macOS in-app updater: which artifact from
// latest-mac.yml we install, where we fetch it from, and how we locate the
// bundle we are replacing. The download / ditto / bundle-swap half of that
// module only runs on macOS and is exercised by hand there.
import { describe, expect, it, vi, afterEach } from "vitest";

// The module imports electron for app paths and net; none of that is reached by
// the functions under test.
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
  net: { request: () => ({ on: () => {}, end: () => {} }) },
}));

const { currentBundlePath, resolveAsset } = await import("../../electron/macUpdater");

const BASE = "https://github.com/dlroqa/streamforge-releases/releases/download";

/** Shaped like the files list electron-builder writes into latest-mac.yml. */
const release = {
  version: "1.0.4",
  files: [
    { url: "StreamForge-1.0.4-arm64.dmg", sha512: "dmg-arm64", size: 1 },
    { url: "StreamForge-1.0.4-arm64-mac.zip", sha512: "zip-arm64", size: 1 },
    { url: "StreamForge-1.0.4.dmg", sha512: "dmg-x64", size: 1 },
    { url: "StreamForge-1.0.4-mac.zip", sha512: "zip-x64", size: 1 },
  ],
} as unknown as Parameters<typeof resolveAsset>[0];

describe("resolveAsset", () => {
  it("picks the arm64 zip on Apple Silicon", () => {
    const asset = resolveAsset(release, BASE, "arm64");
    expect(asset.sha512).toBe("zip-arm64");
    expect(asset.url).toBe(`${BASE}/v1.0.4/StreamForge-1.0.4-arm64-mac.zip`);
  });

  it("picks the x64 zip under Rosetta or on Intel", () => {
    const asset = resolveAsset(release, BASE, "x64");
    expect(asset.sha512).toBe("zip-x64");
    expect(asset.url).toBe(`${BASE}/v1.0.4/StreamForge-1.0.4-mac.zip`);
  });

  it("never offers a dmg, which we cannot install unattended", () => {
    for (const arch of ["arm64", "x64"]) {
      expect(resolveAsset(release, BASE, arch).url).not.toContain(".dmg");
    }
  });

  it("percent-encodes asset names containing spaces", () => {
    const spaced = { version: "2.0.0", files: [{ url: "Stream Forge-mac.zip", sha512: "s" }] };
    expect(resolveAsset(spaced as never, BASE, "x64").url).toBe(
      `${BASE}/v2.0.0/Stream%20Forge-mac.zip`,
    );
  });

  it("passes an absolute asset URL through untouched", () => {
    const absolute = {
      version: "2.0.0",
      files: [{ url: "https://cdn.example.com/StreamForge-mac.zip", sha512: "s" }],
    };
    expect(resolveAsset(absolute as never, BASE, "x64").url).toBe(
      "https://cdn.example.com/StreamForge-mac.zip",
    );
  });

  it("throws rather than guessing when the release has no zip", () => {
    const dmgOnly = { version: "2.0.0", files: [{ url: "StreamForge.dmg", sha512: "s" }] };
    expect(() => resolveAsset(dmgOnly as never, BASE, "arm64")).toThrow(/no macOS \.zip/);
  });
});

describe("currentBundlePath", () => {
  const execPath = process.execPath;
  afterEach(() => {
    Object.defineProperty(process, "execPath", { value: execPath, configurable: true });
  });

  const setExecPath = (value: string) =>
    Object.defineProperty(process, "execPath", { value, configurable: true });

  it("walks up from the helper binary to the .app bundle", () => {
    setExecPath("/Applications/StreamForge.app/Contents/MacOS/StreamForge");
    expect(currentBundlePath()).toBe("/Applications/StreamForge.app");
  });

  it("handles an install outside /Applications", () => {
    setExecPath("/Users/me/Desktop/StreamForge.app/Contents/MacOS/StreamForge");
    expect(currentBundlePath()).toBe("/Users/me/Desktop/StreamForge.app");
  });

  it("returns null when not running from a bundle, so we never swap blind", () => {
    setExecPath("/usr/local/bin/electron");
    expect(currentBundlePath()).toBeNull();
  });
});
