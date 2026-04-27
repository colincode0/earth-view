# Earth View

Earth View is an interactive satellite-imagery globe built with React, Vite, Three.js, and Tailwind CSS. It starts as a full-screen 3D Earth using NASA GIBS daily imagery, then lets you select places, inspect regional NASA and Copernicus Sentinel imagery, compare layers, and build short time-lapse sequences.

The app is intentionally exploratory: orbit the planet, zoom into a region, choose a date and imagery layer, then step into a detailed modal workspace when a location is worth inspecting. The modal can also start an AI chat about the current rendered view, including the image, coordinates, capture context, active provider, and optional user focus text.

## What It Does

- Renders an interactive 3D globe with NASA GIBS WMS imagery wrapped onto a Three.js sphere.
- Supports daily MODIS and VIIRS true-color and false-color base layers, NASA GIBS analytic overlays, and regional Sentinel-2 optical and Sentinel-1 radar layers.
- Shows country borders, state/province boundaries, graticule lines, and tiered city labels.
- Adds optional global overlays for aerosols, cloud-top temperature, precipitable water, sea surface temperature, chlorophyll, snow cover, sea ice, and active fires.
- Adds optional activity overlays for recent USGS earthquakes and open NASA EONET volcano and severe-storm events.
- Switches into a higher-detail 2D imagery overlay when the camera reaches max zoom.
- Opens a regional imagery modal from shift-click or right-click selection.
- Supports date selection, layer switching, pan/zoom, and 7-day or 30-day regional time lapses.
- Requests Copernicus Sentinel-2 optical and Sentinel-1 radar imagery in the same regional modal through local/API server handlers.
- Provides Sentinel scene searches, scene-based time lapses, a five-year sampled comparison, and GIF export for Sentinel sequences.
- Adds an "Ask about this view" AI chat for OpenAI or Anthropic with streaming responses, optional web search, and session-only follow-up context.

## Data Sources

### NASA GIBS

The default imagery providers use NASA GIBS WMS:

- MODIS Terra true color
- MODIS Aqua true color
- VIIRS SNPP true color
- VIIRS NOAA-20 true color
- VIIRS SNPP SWIR false color
- VIIRS SNPP cloud/snow false color
- VIIRS NOAA-20 SWIR false color
- VIIRS Black Marble night lights
- MODIS aerosol optical depth
- MODIS cloud top temperature
- AMSR2 precipitable water
- GHRSST sea surface temperature
- MODIS chlorophyll-a
- MODIS snow cover
- AMSR2 sea ice concentration
- VIIRS active fires
- MODIS active fires

The main true-color and false-color GIBS layers can be used as globe base layers. The analytic GIBS products are registered as translucent overlays that can be stacked over the current base imagery. Some products are pinned to a fixed latest useful date in code when the public GIBS archive does not currently extend to today.

Most GIBS layers are treated as one complete global frame per day. The app defaults to the latest likely complete VIIRS NOAA-20 true-color day, with a small UTC lag to avoid requesting incomplete current-day imagery.

The regional imagery provider list also includes Copernicus Sentinel layers rendered through the local/API Sentinel handler. These layers use the same regional bbox, drag, and zoom workflow as the NASA layers, but they require Copernicus credentials and represent the latest available scene near the selected date rather than a global daily GIBS frame.

### Copernicus Sentinel

The regional Sentinel layers use Copernicus Data Space / Sentinel Hub APIs through server-side endpoints:

- Sentinel-2 true color
- Sentinel-2 false color infrared
- Sentinel-2 SWIR
- Sentinel-1 radar

Sentinel requests require API credentials. Without credentials, the NASA GIBS globe and regional views still work, but Sentinel rendering and Sentinel scene searches will return a configuration error.

### Event And Boundary Overlays

The globe fetches supporting context directly in the browser:

- Natural Earth country and admin-1 boundary GeoJSON, with fallback URLs
- USGS all-day earthquake GeoJSON, filtered to magnitude 2.5 and above
- NASA EONET open volcano events
- NASA EONET open severe-storm events, rendered as tracks when point history is available

These overlays are optional UI toggles. If a feed fails, the corresponding overlay simply renders no markers.

### AI View Analysis

The imagery modal includes an "Ask about this view" panel. The user can choose OpenAI or Anthropic, add optional focus/context text, and open a chat seeded with:

- the currently displayed image
- selected coordinates and date
- capture-time label
- active satellite/provider/layer metadata
- current bbox, zoom degrees, and rendered image dimensions

The first request sends the current image. Follow-up requests keep the visible chat history plus a compact hidden view briefing, so the image does not need to be resent each turn. Responses stream back through a local/API server-sent-events endpoint.

The current default AI models are:

- OpenAI: `gpt-5.2` through the Responses API
- Anthropic: `claude-opus-4-1-20250805` through the Messages API

Both provider requests include web-search tools where supported. Anthropic web search must also be enabled for the organization in the Anthropic Console.

## Getting Started

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

For Sentinel support, fill in:

```bash
COPERNICUS_CLIENT_ID=
COPERNICUS_CLIENT_SECRET=
```

For AI view analysis, fill in one or both provider keys:

```bash
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

Older Sentinel Hub variable names are also supported by the server code, although `.env.example` only lists the preferred Copernicus names:

```bash
SENTINELHUB_CLIENT_ID=
SENTINELHUB_CLIENT_SECRET=
```

Run the app:

```bash
npm run dev
```

Vite serves the app on `127.0.0.1` by default.

## Scripts

```bash
npm run dev      # Start the Vite dev server with local Sentinel API middleware
npm run build    # Type-check and build the production bundle
npm run preview  # Preview the production build locally
npm run lint     # Run ESLint
```

## How To Use The App

- Drag the globe to rotate Earth.
- Scroll or pinch to zoom.
- Use the imagery panel or number keys to switch available base layers.
- Add GIBS analytic overlays from the overlay selector, reorder them, remove them, or clear the overlay stack.
- Toggle activity overlays for earthquakes, volcanoes, and storms.
- Sentinel layers only appear in the globe imagery panel at max zoom; all regional layers are available in the modal layer switcher, with Sentinel listed first.
- At max zoom, the app replaces the globe view with a higher-detail WMS image for the current viewport.
- Shift-click or right-click the globe or max-zoom image to select a point and open the imagery modal.
- In the regional modal, drag to pan, scroll to zoom, shift-click to recenter, change the date, switch layers, or build 7-day and 30-day time lapses.
- For Sentinel layers, the time-lapse controls search and render scene sequences, including a five-year sampled comparison and GIF export.
- To use AI analysis, choose OpenAI or Anthropic, optionally describe what to focus on, then click "Ask about this view." Follow-up questions stay scoped to that chat session and the captured view context.

## Project Structure

```text
.
├── api/
│   ├── ask-view.ts            # Vercel-style JSON endpoint for AI view analysis
│   ├── ask-view-stream.ts     # Vercel-style SSE endpoint for streaming AI view analysis
│   ├── sentinel-image.ts       # Vercel-style endpoint for Sentinel Process API image renders
│   └── sentinel-scenes.ts      # Vercel-style endpoint for Sentinel Catalog scene searches
├── src/
│   ├── App.tsx                 # Top-level app shell and globe/modal composition
│   ├── main.tsx                # React entry point
│   ├── components/
│   │   ├── Globe/              # Three.js globe, overlays, labels, controls, max-zoom imagery
│   │   ├── Modal/              # Imagery modal UI, AI chat, hooks, layer/date/time-lapse dialogs
│   │   └── ui/                 # Small Radix/Tailwind UI primitives
│   ├── lib/
│   │   ├── captureTime.ts      # Estimated and exact capture-time formatting
│   │   ├── cities.ts           # City label data
│   │   ├── dates.ts            # Date helpers and latest-default imagery logic
│   │   ├── geo.ts              # Coordinate, bbox, distance, and zoom math
│   │   ├── gif.ts              # Browser-side animated GIF encoder
│   │   ├── sentinelVariants.ts # Sentinel layer definitions and evalscripts
│   │   └── utils.ts            # Shared class-name utility
│   ├── providers/
│   │   ├── GibsProvider.ts     # NASA GIBS WMS URL builder/provider implementation
│   │   ├── SentinelProvider.ts # Copernicus Sentinel regional provider implementation
│   │   └── registry.ts         # Registered imagery providers
│   ├── server/
│   │   ├── askView.ts          # AI view analysis prompts, provider calls, streaming relay
│   │   └── sentinel.ts         # Sentinel auth, image requests, catalog searches, validation
│   ├── store/
│   │   └── useAppStore.ts      # Zustand app state for selected point, layer, date, camera, modal
│   ├── styles/
│   │   └── globals.css         # Tailwind imports, theme tokens, global app styling
│   └── types/
│       └── imagery.ts          # Shared imagery provider and bbox types
├── vite.config.ts              # Vite config, path alias, and local API middleware
├── tailwind.config.ts          # Tailwind theme configuration
├── eslint.config.js            # ESLint flat config
└── package.json                # Scripts and dependencies
```

## Architecture Notes

### Rendering Flow

`src/components/Globe/Globe.tsx` owns the Three.js canvas. It builds a global NASA GIBS texture URL for globe-capable providers, renders the Earth sphere, applies optional transparent GIBS overlay textures, mounts boundary/city/event overlays, and reports camera-derived viewport information back to the Zustand store. Regional-only Sentinel providers keep the globe on a default global true-color texture while the regional modal renders the selected Sentinel layer.

`src/components/Globe/MaxZoomImagery.tsx` listens for max-zoom globe state. When the camera is close enough, it requests a WMS image for the visible bounding box and presents it as a 2D overlay. This allows clearer local inspection than stretching the global sphere texture.

`src/components/Globe/CameraHotkeys.tsx` owns the floating imagery panel, number-key layer switching, GIBS overlay stack controls, and activity overlay toggles.

### Selection And Modal State

`src/store/useAppStore.ts` is the central state store. It tracks:

- selected coordinates
- current globe viewport
- active imagery layer
- active GIBS overlay layers
- activity overlay toggles
- selected date
- modal open/closed state
- imagery zoom level
- camera focus requests

`src/components/Modal/ImageryModal.tsx` is the main inspection workspace. It keeps the dialog layout and control wiring in one place, while `src/components/Modal/hooks/` owns the focused behavior for pane sizing, object URL cleanup, regional imagery loading, Sentinel scene requests, and time-lapse orchestration.

`src/components/Modal/AskViewModal.tsx` owns the AI chat UI. It captures the current rendered image as a data URL, sends it with structured view metadata, streams assistant text into the chat, and preserves a compact hidden view briefing for follow-up questions. If the current imagery position, date, layer, or zoom changes while the chat is open, the chat shows a stale-context notice and can restart against the new view.

### Imagery Providers

Regional imagery follows a provider interface in `src/types/imagery.ts`. `GibsProvider` implements that interface by producing WMS `GetMap` URLs and can be marked `overlayOnly` for analytic products that should stack over a base layer. `SentinelProvider` implements the same interface by requesting Sentinel imagery through the server/API layer. The registry in `src/providers/registry.ts` is the main place to add, remove, or reorder base, overlay, and regional layers.

Sentinel imagery is modeled separately in `src/lib/sentinelVariants.ts` because each layer needs a Copernicus collection, resolution, request window, and evalscript.

### Sentinel Server Layer

`src/server/sentinel.ts` contains the shared server logic for both local development and deployment:

- credential lookup
- access-token caching
- request validation
- Sentinel Process API image rendering
- Sentinel Catalog API scene searches
- scene de-duplication by minute
- cloud filtering for Sentinel-2

Sentinel 7-scene and 30-scene time lapses search a larger pool of catalog candidates, then render the latest usable distinct scenes so cloud filtering and de-duplication do not prematurely cap the sequence.

During local development, `vite.config.ts` mounts this logic as middleware at:

- `POST /api/sentinel-image`
- `POST /api/sentinel-scenes`

For Vercel-style deployments, the same functions are exposed from `api/sentinel-image.ts` and `api/sentinel-scenes.ts`.

### AI Server Layer

`src/server/askView.ts` contains the shared server logic for local development and deployment:

- request validation and API-key checks
- view-context prompt construction
- OpenAI Responses API calls
- Anthropic Messages API calls
- optional web-search tool configuration
- streamed response parsing
- hidden `VIEW_BRIEFING` extraction for follow-up turns

During local development, `vite.config.ts` mounts this logic as middleware at:

- `POST /api/ask-view`
- `POST /api/ask-view-stream`

For Vercel-style deployments, the same functions are exposed from `api/ask-view.ts` and `api/ask-view-stream.ts`.

## Adding A New Imagery Layer

For a NASA GIBS WMS layer:

1. Add a new `GibsProvider` entry in `src/providers/registry.ts`.
2. Set the GIBS `layerId`, display metadata, satellite, category, nominal resolution, and caveats.
3. The layer automatically appears in the globe hotkey panel, modal layer switcher, and imagery info dialog.

For a NASA GIBS overlay:

1. Add a new `GibsProvider` entry in `src/providers/registry.ts`.
2. Set `overlayOnly: true` so it appears in the overlay selector instead of the base-layer list.
3. Use `fixedDate` when a product has a known archive end date that should override the selected app date.

For a Sentinel layer:

1. Add a new entry in `src/lib/sentinelVariants.ts`.
2. Provide the collection, nominal resolution, request window, metadata, and evalscript.
3. Confirm `src/server/sentinel.ts` supports the required collection-specific `dataFilter` and processing options.

For a regional Sentinel provider:

1. Add or update a provider in `src/providers/` that implements the shared imagery provider interface.
2. Request the matching Sentinel variant through the local/API endpoints.
3. Register the provider in `src/providers/registry.ts`.

## Deployment Notes

The app is a Vite SPA with serverless-style Sentinel and AI endpoints. The static build is produced by `npm run build`; deployment environments must also provide Sentinel credentials if Sentinel rendering should work and AI provider keys if Ask View should work.

NASA GIBS imagery, boundary GeoJSON, USGS earthquakes, and NASA EONET event feeds are fetched directly by the browser. Sentinel and AI credentials are never sent to the browser; they are read only by the server/API layer.

## Current Notes

`NOTES.md` contains short working notes and possible follow-up tasks. It is not required for running the app, but it is useful project context for current ideas around AIS ship tracks, OPERA/ASF Sentinel-1 RTC products, and Sentinel mosaic scene highlighting.
