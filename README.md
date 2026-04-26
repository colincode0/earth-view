# Earth View

Earth View is an interactive satellite-imagery globe built with React, Vite, Three.js, and Tailwind CSS. It starts as a full-screen 3D Earth using NASA GIBS daily imagery, then lets you select places, inspect regional imagery, compare layers, build short time-lapse sequences, and request higher-resolution Copernicus Sentinel scenes for a focused area.

The app is intentionally exploratory: orbit the planet, zoom into a region, choose a date and imagery layer, then step into a detailed modal workspace when a location is worth inspecting.

## What It Does

- Renders an interactive 3D globe with NASA GIBS WMS imagery wrapped onto a Three.js sphere.
- Supports daily MODIS and VIIRS true-color and false-color layers.
- Shows country borders, state/province boundaries, graticule lines, and tiered city labels.
- Switches into a higher-detail 2D imagery overlay when the camera reaches max zoom.
- Opens a regional imagery modal from shift-click or right-click selection.
- Supports date selection, layer switching, pan/zoom, and 7-day or 30-day daily GIBS time lapses.
- Requests Copernicus Sentinel-2 optical and Sentinel-1 radar imagery through local/API server handlers.
- Provides Sentinel scene searches, scene-based time lapses, a five-year sampled comparison, and GIF export for Sentinel sequences.

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

These layers are treated as one complete global frame per day. The app defaults to the latest likely complete true-color day, with a small lag to avoid requesting incomplete current-day imagery.

### Copernicus Sentinel

The high-resolution workspace uses Copernicus Data Space / Sentinel Hub APIs through server-side endpoints:

- Sentinel-2 true color
- Sentinel-2 false color infrared
- Sentinel-2 SWIR
- Sentinel-1 radar

Sentinel requests require API credentials. Without credentials, the NASA GIBS globe and regional views still work, but Sentinel rendering and Sentinel scene searches will return a configuration error.

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

Older Sentinel Hub variable names are also supported by the server code:

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
- Use the imagery panel or number keys `1` through `7` to switch NASA GIBS layers.
- At max zoom, the app replaces the globe view with a higher-detail WMS image for the current viewport.
- Shift-click or right-click the globe or max-zoom image to select a point and open the imagery modal.
- In the regional modal, drag to pan, scroll to zoom, change the date, switch layers, or build 7-day and 30-day time lapses.
- Click "Render Sentinel-2 high-res" to request a focused Sentinel scene for the selected area.
- In Sentinel mode, switch Sentinel variants, refine the current client-side zoom into a new server-rendered image, request scene sequences, or export a GIF.

## Project Structure

```text
.
├── api/
│   ├── sentinel-image.ts       # Vercel-style endpoint for Sentinel Process API image renders
│   └── sentinel-scenes.ts      # Vercel-style endpoint for Sentinel Catalog scene searches
├── src/
│   ├── App.tsx                 # Top-level app shell and globe/modal composition
│   ├── main.tsx                # React entry point
│   ├── components/
│   │   ├── Globe/              # Three.js globe, overlays, labels, controls, max-zoom imagery
│   │   ├── Modal/              # Regional imagery, Sentinel workspace, layer/date/time-lapse dialogs
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
│   │   └── registry.ts         # Registered imagery providers
│   ├── server/
│   │   └── sentinel.ts         # Sentinel auth, image requests, catalog searches, validation
│   ├── store/
│   │   └── useAppStore.ts      # Zustand app state for selected point, layer, date, camera, modal
│   ├── styles/
│   │   └── globals.css         # Tailwind imports, theme tokens, global app styling
│   └── types/
│       └── imagery.ts          # Shared imagery provider and bbox types
├── vite.config.ts              # Vite config, path alias, and local Sentinel API middleware
├── tailwind.config.ts          # Tailwind theme configuration
├── eslint.config.js            # ESLint flat config
└── package.json                # Scripts and dependencies
```

## Architecture Notes

### Rendering Flow

`src/components/Globe/Globe.tsx` owns the Three.js canvas. It builds a global NASA GIBS texture URL for the active provider/date, renders the Earth sphere, and reports camera-derived viewport information back to the Zustand store.

`src/components/Globe/MaxZoomImagery.tsx` listens for max-zoom globe state. When the camera is close enough, it requests a WMS image for the visible bounding box and presents it as a 2D overlay. This allows clearer local inspection than stretching the global sphere texture.

### Selection And Modal State

`src/store/useAppStore.ts` is the central state store. It tracks:

- selected coordinates
- current globe viewport
- active imagery layer
- selected date
- modal open/closed state
- imagery zoom level
- camera focus requests

`src/components/Modal/ImageryModal.tsx` is the main inspection workspace. It handles regional GIBS requests, date/layer changes, modal mode switching, pan/zoom behavior, time-lapse loading, Sentinel scene requests, and Sentinel refinement.

### Imagery Providers

NASA imagery follows a provider interface in `src/types/imagery.ts`. `GibsProvider` implements that interface by producing WMS `GetMap` URLs. The registry in `src/providers/registry.ts` is the main place to add, remove, or reorder NASA GIBS layers.

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

During local development, `vite.config.ts` mounts this logic as middleware at:

- `POST /api/sentinel-image`
- `POST /api/sentinel-scenes`

For Vercel-style deployments, the same functions are exposed from `api/sentinel-image.ts` and `api/sentinel-scenes.ts`.

## Adding A New Imagery Layer

For a NASA GIBS WMS layer:

1. Add a new `GibsProvider` entry in `src/providers/registry.ts`.
2. Set the GIBS `layerId`, display metadata, satellite, category, nominal resolution, and caveats.
3. The layer automatically appears in the globe hotkey panel, modal layer switcher, and imagery info dialog.

For a Sentinel layer:

1. Add a new entry in `src/lib/sentinelVariants.ts`.
2. Provide the collection, nominal resolution, request window, metadata, and evalscript.
3. Confirm `src/server/sentinel.ts` supports the required collection-specific `dataFilter` and processing options.

## Deployment Notes

The app is a Vite SPA with serverless-style Sentinel endpoints. The static build is produced by `npm run build`; deployment environments must also provide Sentinel credentials if Sentinel rendering should work.

NASA GIBS imagery and external boundary GeoJSON are fetched directly by the browser. Sentinel credentials are never sent to the browser; they are read only by the server/API layer.

## Current Notes

`NOTES.md` contains short working notes and possible follow-up tasks. It is not required for running the app, but it is useful project context for current UX ideas around layered modals, Sentinel date behavior, and future imagery workflows.
