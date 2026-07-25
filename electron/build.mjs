// Bundle the Electron main + preload TypeScript to CommonJS in ./electron-dist,
// and copy the picker window's HTML alongside them. Kept deliberately tiny —
// no framework, just esbuild — so the desktop layer stays easy to manipulate.
import { build } from "esbuild";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "..");
const outdir = path.join(root, "electron-dist");

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [
    path.join(dir, "main.ts"),
    path.join(dir, "preload.ts"),
  ],
  outdir,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  // Electron is provided by the runtime, never bundled.
  external: ["electron"],
});

await copyFile(path.join(dir, "picker.html"), path.join(outdir, "picker.html"));
await copyFile(path.join(dir, "splash.html"), path.join(outdir, "splash.html"));

// The root package.json is `"type": "module"`, which would make Node treat the
// bundled *.js here as ESM and reject their CommonJS `require`. This marker
// scopes electron-dist/ back to CommonJS.
await writeFile(
  path.join(outdir, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
);

// eslint-disable-next-line no-console
console.log("[StreamForge] Electron layer built → electron-dist/");
