// Minimal same-origin static file server for the built SPA.
//
// Why a real HTTP server instead of Electron's `file://` or a custom `app://`
// scheme: StreamForge's OAuth flow computes redirect URIs from
// `window.location.origin` and its popup relays the auth code back with a
// strict `e.origin === window.location.origin` check (see
// src/lib/platformConnect.ts + src/pages/OAuthCallback.tsx). A `file://` /
// `app://` origin is opaque and would break both the OAuth providers'
// registered redirect URIs and the postMessage origin check. Serving the
// bundle from a fixed `http://localhost:8080` origin keeps the desktop app
// byte-for-byte identical to the web deployment.
import http from "node:http";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export interface StaticServer {
  origin: string;
  port: number;
  close: () => Promise<void>;
}

/** True if `child` is inside `root` (blocks path-traversal escapes). */
function isInside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function tryFile(root: string, urlPath: string): Promise<string | null> {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  let target = path.join(root, decoded);
  if (!isInside(root, target)) return null;
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) target = path.join(target, "index.html");
    await fs.access(target);
    return target;
  } catch {
    return null;
  }
}

/**
 * Serve `rootDir` over HTTP on 127.0.0.1. Prefers `preferredPort`, falling
 * back to the next free port if it is taken. Deep links fall back to
 * index.html (BrowserRouter), and the HTML entry is marked no-store — mirroring
 * the app's public/_headers on Cloudflare.
 */
export function startStaticServer(
  rootDir: string,
  preferredPort = 8080,
): Promise<StaticServer> {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = req.url && req.url !== "/" ? req.url : "/index.html";
      let filePath = await tryFile(rootDir, urlPath);

      // SPA fallback: unknown non-asset paths (client routes like /editor,
      // /oauth/callback) serve index.html so react-router can handle them.
      if (!filePath) filePath = path.join(rootDir, "index.html");

      const ext = path.extname(filePath).toLowerCase();
      const isEntry = ext === ".html";
      res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
      res.setHeader(
        "Cache-Control",
        isEntry
          ? "no-store, must-revalidate"
          : "public, max-age=31536000, immutable",
      );

      const stream = createReadStream(filePath);
      stream.on("error", () => {
        res.statusCode = 404;
        res.end("Not found");
      });
      stream.pipe(res);
    } catch {
      res.statusCode = 500;
      res.end("Server error");
    }
  });

  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Port taken — let the OS pick a free one. Note: OAuth redirect URIs
        // are registered against :8080, so a fallback port means OAuth needs
        // that origin registered too. Logged for visibility.
        server.removeListener("error", onError);
        server.once("error", reject);
        server.listen(0, "127.0.0.1");
      } else {
        reject(err);
      }
    };
    server.once("error", onError);
    server.listen(preferredPort, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : preferredPort;
      if (port !== preferredPort) {
        // eslint-disable-next-line no-console
        console.warn(
          `[StreamForge] Port ${preferredPort} busy; serving on ${port}. ` +
            `OAuth redirect URIs registered for :${preferredPort} will need :${port} too.`,
        );
      }
      resolve({
        origin: `http://localhost:${port}`,
        port,
        close: () =>
          new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
