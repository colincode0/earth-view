import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(dir, "build");
mkdirSync(outDir, { recursive: true });

// Bundle the Electron main process and preload. `main.ts` pulls in `server.ts`,
// `config.ts`, and the shared `src/server/*` modules, so each entry produces a
// self-contained CommonJS file with no runtime node_modules dependency (other
// than electron itself, which is marked external). Output is `.cjs` so Electron
// loads it as CommonJS regardless of any `"type": "module"`.
await build({
  entryPoints: [path.join(dir, "main.ts"), path.join(dir, "preload.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outdir: outDir,
  outExtension: { ".js": ".cjs" },
  external: ["electron"],
  logLevel: "info",
});

// The settings page is served by the local HTTP server, so it must sit next to
// the bundled main (both end up inside the packaged app's asar).
copyFileSync(path.join(dir, "settings.html"), path.join(outDir, "settings.html"));

console.log("Desktop build complete -> build/main.cjs + build/preload.cjs + build/settings.html");
