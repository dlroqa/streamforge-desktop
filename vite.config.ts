import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      // Motion Graphics render service (hyperframes-service/). Proxied so the
      // browser only ever talks to :8080 — remote/forwarded-port setups (VS
      // Code, Codespaces) don't expose :8791 to the browser's localhost.
      "/hyperframes": {
        target: process.env.HYPERFRAMES_UPSTREAM || "http://localhost:8791",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/hyperframes/, ""),
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  // Bundle Web Workers as ES modules so the ASR worker's transformers.js import
  // resolves correctly (the teleprompter's on-device voice engine).
  worker: {
    format: "es",
  },
  // ffmpeg.wasm spins up its own Web Worker and loads a large same-origin core;
  // Vite's dep pre-bundling mangles that worker/import graph, so exclude it and
  // let the packages resolve as-published.
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Intentionally NO manualChunks. Hand-splitting React / Radix / Supabase
    // into named vendor chunks produced cross-chunk React resolution that
    // crashed with "Cannot read properties of undefined (reading
    // 'forwardRef')" — and the crash was build-environment dependent (it
    // surfaced in Cloudflare's build but not local ones), so it can't be
    // caught before deploy. Rollup's automatic chunking orders module
    // initialization correctly; lazy imports (recharts, daily-js, pdfjs,
    // slideshow) still become their own async chunks on their own.
  },
}));
