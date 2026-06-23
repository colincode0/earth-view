# Earth View — Desktop Build

This folder packages Earth View as a standalone Windows desktop app (`.exe`) using
[Electron](https://www.electronjs.org/) and
[electron-builder](https://www.electron.build/). It is **fully separate** from the web app:

- The web app (`npm run dev` / `npm run build` in the repo root) is untouched.
- All desktop-only code lives here in `desktop/`.
- The shared Sentinel and Ask AI logic in `../src/server/*` is reused as-is — no duplication.

## How it works

Electron's main process ([`main.ts`](main.ts)) starts a tiny localhost HTTP server
([`server.ts`](server.ts)) that:

1. Serves the built frontend (`dist/`).
2. Mirrors the four `/api/*` routes from the repo's `vite.config.ts`, calling the same
   `../src/server/*` functions.
3. Reads API keys from a local config file instead of `.env`.

The window loads `http://127.0.0.1:<port>/`, so the frontend's relative `/api/*` fetches work
unchanged. NASA GIBS imagery works immediately with no keys; users add their own Copernicus /
OpenAI / Anthropic keys via the **Settings (API keys)** menu item. Keys are saved to
`%APPDATA%/Earth View/config.json` and used live (no restart needed).

## Build & run locally

From the **repo root**, build the frontend first:

```powershell
npm install
npm run build
```

Then from this `desktop/` folder:

```powershell
cd desktop
npm install
npm run dev      # builds the main process and launches the app in dev
```

Use the **Settings (API keys)** menu item (or `Ctrl + ,`) to paste keys and test Sentinel / Ask AI.

## Produce the installer (.exe)

`npm run dist` builds the frontend, bundles the Electron main, and packages the
installer in one step (no need to run the root build separately):

```powershell
cd desktop
npm install
npm run dist
```

The installer is written to `desktop/release/Earth-View-Setup.exe`.

## Distributing the download

Attach `Earth-View-Setup.exe` to a [GitHub Release](https://docs.github.com/en/repositories/releasing-projects-on-github),
then link it from the repo README. Because the filename is version-less, the
"latest release" asset URL is permanent:

```
https://github.com/colincode0/earth-view/releases/latest/download/Earth-View-Setup.exe
```

> Note: the installer is unsigned, so Windows SmartScreen will show a "Windows protected your PC"
> prompt on first run (users click **More info → Run anyway**). Code signing removes this and can be
> added later.

## Notes

- No production npm dependencies ship in the app — `main.cjs` is fully bundled by esbuild, so the
  packaged size stays modest.
- To automate builds, a GitHub Actions workflow can run `npm run build` (root) + `npm run dist`
  (here) on a version tag and upload the `.exe` to the release.
