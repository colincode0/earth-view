<img width="720" height="397" alt="vid_readme" src="https://github.com/user-attachments/assets/fa0cea26-17d4-475c-9544-a695d3ff43f8" />



# Earth View

Earth View is an open-source satellite imagery explorer built with React, Vite, Three.js, Tailwind CSS, and Zustand. It starts with a 3D NASA GIBS globe, lets you zoom into a detailed regional pass, and opens a modal workspace for higher-resolution inspection, Sentinel imagery, time lapses, Google Maps handoff, and optional AI-assisted image analysis.

This README is focused on getting a new copy running from scratch. For deeper architecture notes and feature details, see [README-extended.md](README-extended.md).

## What Works Without API Keys

You can run the app immediately with no credentials. The no-key mode includes:

- NASA GIBS global globe imagery
- MODIS and VIIRS base layers
- GIBS analytic overlays
- borders, graticule, city labels, and activity overlays
- detailed max-zoom regional GIBS imagery
- modal pan/zoom, date/layer controls, GIBS time lapses, and Google Maps links

Optional credentials unlock:

- Copernicus Sentinel-2 and Sentinel-1 regional imagery, scene lists, Sentinel time lapses, and GIF export
- Ask AI chat in the modal through OpenAI and/or Anthropic

## Requirements

- Node.js 18 or newer
- npm
- A modern browser with WebGL support

## Quick Start

Clone the repo:

```bash
git clone <your-fork-or-repo-url>
cd earth-view
```

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Start the dev server:

```bash
npm run dev
```

Open the app at:

```text
http://127.0.0.1:5173
```

If you add or change `.env` values while the dev server is running, stop it and restart `npm run dev`.

## Environment Variables

`.env.example` contains all supported local variables:

```bash
COPERNICUS_CLIENT_ID=
COPERNICUS_CLIENT_SECRET=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

All of these are optional for basic NASA GIBS usage. Do not prefix them with `VITE_`; they are read by the local/API server layer and should not be exposed to browser code.

Older Sentinel Hub variable names are still accepted:

```bash
SENTINELHUB_CLIENT_ID=
SENTINELHUB_CLIENT_SECRET=
```

Prefer `COPERNICUS_CLIENT_ID` and `COPERNICUS_CLIENT_SECRET` for new setups.

## Copernicus Sentinel Setup

Sentinel support is optional, but it unlocks regional Sentinel-2 and Sentinel-1 imagery in the modal.

1. Create a Copernicus Data Space Ecosystem account.
2. Open the [Copernicus Data Space Sentinel Hub Dashboard](https://shapps.dataspace.copernicus.eu/dashboard/).
3. Go to user settings and find the OAuth clients section.
4. Create an OAuth client.
5. Copy the client ID and client secret immediately. The secret may not be shown again after the dialog closes.
6. Add them to `.env`:

```bash
COPERNICUS_CLIENT_ID=your_client_id
COPERNICUS_CLIENT_SECRET=your_client_secret
```

The app uses these credentials server-side to request access tokens from the Copernicus Data Space token endpoint, then calls the Sentinel Hub Process and Catalog APIs. The official authentication guide is here: [Sentinel Hub API authentication](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/Authentication.html).

After saving `.env`, restart the dev server.

## Ask AI Setup

Ask AI is optional. It appears inside the modal and can analyze the currently displayed image with view context such as coordinates, date, imagery provider, bbox, scene metadata, and follow-up chat history.

You can configure either provider or both.

### OpenAI

1. Create or open an OpenAI Platform account.
2. Create an API key from the [OpenAI API keys page](https://platform.openai.com/api-keys).
3. Add it to `.env`:

```bash
OPENAI_API_KEY=your_openai_key
```

OpenAI's current quickstart is here: [OpenAI developer quickstart](https://platform.openai.com/docs/quickstart).

### Anthropic

1. Create or open a Claude Console account.
2. Create an API key from the Claude Console account settings.
3. Add it to `.env`:

```bash
ANTHROPIC_API_KEY=your_anthropic_key
```

Anthropic's current API overview is here: [Claude API overview](https://docs.anthropic.com/en/api/getting-started).

After saving `.env`, restart the dev server.

## How To Use The App

On the globe:

- Drag to orbit Earth.
- Scroll or pinch to zoom around the cursor.
- Use the imagery panel to switch base layers and manage overlays.
- Toggle boundaries, labels, and activity overlays.
- Zoom close to enter the detailed regional view.
- Shift-click or right-click the globe or detailed view to open the modal.

In the modal:

- Drag to pan.
- Scroll to cursor-zoom.
- Shift-click to recenter.
- Change the date or imagery layer from the sidebar.
- Open Google Maps for the selected coordinate.
- Build GIBS or Sentinel time lapses.
- Use Ask AI when an OpenAI or Anthropic key is configured.

## Available Scripts

```bash
npm run dev      # Start Vite with local API middleware
npm run build    # Type-check and build the production bundle
npm run preview  # Preview the production build locally
npm run lint     # Run ESLint
```

## Data Sources

- [NASA GIBS](https://www.earthdata.nasa.gov/technology/gibs): global and regional MODIS/VIIRS imagery plus analytic overlays. No API key is required.
- [Copernicus Data Space Ecosystem / Sentinel Hub APIs](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub.html): optional Sentinel-2 and Sentinel-1 regional imagery. OAuth client credentials are required.
- [USGS Earthquake Hazards Program](https://earthquake.usgs.gov/earthquakes/feed/): recent earthquake overlay.
- [NASA EONET](https://eonet.gsfc.nasa.gov/): volcano and severe-storm event overlays.
- [Natural Earth](https://www.naturalearthdata.com/): boundary context.

## Deployment

The app is a Vite SPA with serverless-style API handlers in `api/`.

For a hosted deployment:

1. Install dependencies with `npm install`.
2. Build with `npm run build`.
3. Serve the generated `dist/` directory.
4. Configure the same environment variables on the host for Sentinel and Ask AI features.
5. Make sure the host supports the API routes in `api/` or adapt them to your server/runtime.

NASA GIBS-only functionality does not require server-side credentials, but Sentinel and Ask AI do.

## Troubleshooting

**The globe loads but Sentinel layers fail**

Check that `COPERNICUS_CLIENT_ID` and `COPERNICUS_CLIENT_SECRET` are set in `.env`, then restart the dev server. Also confirm the OAuth client is active in the Copernicus Data Space Sentinel Hub Dashboard.

**Ask AI is visible but requests fail**

Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, restart the dev server, and verify the provider account has billing/API access enabled.

**Environment variables are not being picked up**

Restart `npm run dev`. Vite and the local API middleware read `.env` at server startup.

**Imagery appears stale for the current day**

Some public satellite products lag behind real time. The app intentionally defaults to a recent likely complete VIIRS day to avoid requesting incomplete current-day true-color imagery.

**The browser is sluggish**

The globe uses large WebGL textures and can be demanding on older hardware. Try closing other GPU-heavy tabs or reducing browser zoom.

## Project Notes

The concise setup guide lives here in `README.md`. The fuller technical document is preserved as [README-extended.md](README-extended.md), including architecture notes, provider details, and implementation-oriented guidance.
