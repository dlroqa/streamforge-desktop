// electron-builder afterPack hook — ad-hoc code signing for unsigned macOS builds.
//
// We ship StreamForge without an Apple Developer certificate. electron-builder
// skips signing entirely in that case, which is fine on Intel but breaks on
// Apple Silicon: macOS refuses to launch an arm64 binary that carries no
// signature at all ("app is damaged and can't be opened"). Ad-hoc signing
// (`codesign --sign -`) produces a valid, if untrusted, signature so the app
// actually runs.
//
// This is NOT notarization. Users still clear the download quarantine once —
// see the README's "Installing the unsigned macOS build" section.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  // --deep so the nested Electron helper apps and frameworks are signed too;
  // an unsigned helper is enough on its own to make the bundle unlaunchable.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });

  console.log(`[StreamForge] ad-hoc signed ${appPath}`);
};
