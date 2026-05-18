---
name: earth-view-imagery-providers
description: Work on Earth View imagery layers and provider wiring. Use when adding, removing, reordering, or debugging NASA GIBS layers, GIBS overlays, Copernicus Sentinel variants, provider metadata, layer categories, capture-time labels, default dates, or the shared ImageryProvider interface.
---

# Earth View Imagery Providers

Use this skill when the task is about imagery layer definitions rather than a specific UI surface.

## Start Here

Read these files first:

1. `src/providers/registry.ts` for all registered GIBS and Sentinel providers and modal ordering.
2. `src/providers/GibsProvider.ts` for WMS URL construction.
3. `src/providers/SentinelProvider.ts` for regional Sentinel image requests.
4. `src/lib/sentinelVariants.ts` for Sentinel collections, evalscripts, request windows, and metadata.
5. `src/types/imagery.ts` for the shared provider contract.
6. `src/lib/captureTime.ts` and `src/lib/dates.ts` for displayed capture labels and default date behavior.

## Provider Model

Every imagery layer implements `ImageryProvider`:

- `id`: stable app identifier.
- `layerId`: NASA GIBS WMS layer id when globe/WMS-capable.
- `sentinelVariantId`: Sentinel variant id when backed by Sentinel API.
- `overlayOnly`: true for GIBS analytic overlays that stack over a base layer.
- `fixedDate`: optional date override for products whose public archive does not extend to the selected date.
- `fetchImage(params)`: returns either a URL string or `Blob`.

`imageryProviders` is the canonical registry. `modalImageryProviders` lists Sentinel providers first, then all other providers.

## GIBS Layers

For a new GIBS base layer:

1. Add a `new GibsProvider(...)` entry in `src/providers/registry.ts`.
2. Provide `id`, NASA `layerId`, display name, satellite, category, resolution, summary, bestFor, and caveat.
3. Add capture timing in `src/lib/captureTime.ts` if the estimated pass time should differ from the default.
4. Check the layer appears in globe controls, modal layer switcher, and imagery info.

For a new GIBS overlay:

1. Add a `GibsProvider` entry.
2. Set `overlayOnly: true`.
3. Use `fixedDate` when the product should ignore the user-selected date.
4. Confirm it is excluded from base-layer lists and available in the overlay selector.

GIBS WMS URLs are built in EPSG:4326 by `GibsProvider.ts`. Keep bbox ordering consistent with the existing `bboxParam` implementation.

## Sentinel Layers

For a new Sentinel visualization:

1. Add a variant in `src/lib/sentinelVariants.ts`.
2. Choose `collection`: `sentinel-2-l2a` or `sentinel-1-grd`.
3. Set request window, resolution, summary, bestFor, caveat, and evalscript.
4. Register it with `new SentinelProvider({ id, variantId })` in `src/providers/registry.ts`.
5. Confirm `src/server/sentinel.ts` supports the collection-specific `dataConfig`.

Current Sentinel variants:

- `s2-true-color`: Sentinel-2 RGB natural color.
- `s2-false-color`: Sentinel-2 NIR false color.
- `s2-swir`: Sentinel-2 SWIR false color.
- `s1-radar`: Sentinel-1 SAR.

Sentinel providers require server/API credentials and only render regional images. Do not expect them to work as global globe textures.

## Date And Capture Labels

Default app date comes from `getLatestTrueColorImagery()`, which uses a UTC lag to avoid incomplete current-day VIIRS imagery.

Use `fixedDate` for products pinned to known archive dates, such as Black Marble and some AMSR2 products.

For UI labels:

- GIBS uses `formatGibsCaptureTime(date, providerId, lon?)`.
- Sentinel uses `formatSentinelCaptureTime(date, variantId, lon?)` unless exact scene acquisition times are available.
- Scene mosaics use exact acquisition times from `formatExactCaptureTime` and `formatSceneAcquisition`.

## Common Traps

- Do not put `overlayOnly` layers into base-layer behavior by accident.
- Do not add Sentinel providers without matching `sentinelVariants` entries.
- Do not assume credentials exist during local verification.
- Keep provider ids stable; they are stored in app state and used by UI controls.
- Keep layer descriptions concise but useful because imagery info displays them directly.

## Validation

Run:

```bash
npm run lint
```

When changing providers, manually inspect:

- globe imagery list
- overlay selector
- modal layer switcher
- imagery info modal
- capture label in app header and modal
- Sentinel error handling when credentials are absent
