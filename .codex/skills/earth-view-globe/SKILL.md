---
name: earth-view-globe
description: Work on Earth View's globe experience. Use when editing or debugging the Three.js globe, NASA GIBS globe textures, camera controls, max-zoom 2D overlay, globe layer hotkeys, GIBS overlay stack, city/boundary labels, event overlays, or globe-to-modal point selection flow.
---

# Earth View Globe

Use this skill to move quickly through the globe-side architecture without rediscovering the whole app.

## Start Here

Read these files first, in this order:

1. `src/App.tsx` for composition of `Globe`, `MaxZoomImagery`, `CameraHotkeys`, and `ImageryModal`.
2. `src/components/Globe/Globe.tsx` for the canvas, camera reporting, global GIBS texture selection, overlays, and selection handoff.
3. `src/components/Globe/MaxZoomImagery.tsx` for the 2D detailed overlay shown at max zoom.
4. `src/components/Globe/CameraHotkeys.tsx` for the floating imagery panel, number keys, overlay stack UI, overlay loading state, and activity toggles.
5. `src/store/useAppStore.ts` for shared state and globe-to-modal transitions.

## Mental Model

Treat the globe view as the broad exploration surface. It renders a Three.js sphere with global NASA GIBS WMS textures, optional transparent GIBS overlays, boundary/city/event context, and camera-derived viewport state.

The globe does not render Sentinel as a true sphere texture. If the active provider has no `layerId`, `Globe.tsx` falls back to `viirs-noaa20` for the global texture. Sentinel imagery belongs to max-zoom/regional/modal flows.

## Core Files

- `src/components/Globe/Globe.tsx`: canvas, lights, starfield, Earth texture URLs, overlay textures/load status, activity overlays, `AdaptiveControls`.
- `src/components/Globe/Earth.tsx`: texture loading/caching, sphere mesh, shift-click and right-click selection handlers.
- `src/components/Globe/MaxZoomImagery.tsx`: flat detailed imagery overlay, viewport bbox math, drag-to-pan, shift/right-click selection from image coordinates.
- `src/components/Globe/CameraHotkeys.tsx`: imagery panel, number-key layer switching, visibility toggle, overlay add/reorder/remove, overlay load icons, activity toggles.
- `src/components/Globe/BoundaryLines.tsx`: Natural Earth boundaries and graticule geometry.
- `src/components/Globe/CityLabels.tsx`: tiered globe labels hidden when modal or max-zoom overlay is active, with low HTML z-index so app panels stay above labels.
- `src/components/Globe/EventOverlays/*`: USGS/EONET fetches, marker details, hover popups, and markers/tracks.
- `src/lib/geo.ts`: lat/lon vector math, bbox math, zoom conversions, coordinate formatting.

## State Flow

`useAppStore` is the contract between the globe and the rest of the app.

- `globeView`: current center lat/lon, spans, camera distance, and `atMaxZoom`.
- `layerId`: active imagery provider.
- `overlayLayerIds`: ordered GIBS overlay stack.
- `overlayLoadStatuses`: per-overlay loading/loaded status keyed by provider id and texture URL.
- `activityOverlays`: `earthquakes`, `volcanoes`, and `storms`.
- `imageryVisible`: base imagery visibility toggle.
- `selectPoint(lat, lon, zoom?)`: opens the modal and sets selected point.
- `focusGlobeAt(lat, lon, options?)`: recenters the camera, used by max-zoom panning and modal-related flows.

When changing globe behavior, preserve this state contract unless the user explicitly wants a larger state redesign.

## Max-Zoom Overlay

`AdaptiveControls` marks `atMaxZoom` when camera distance is `<= 1.085`. `MaxZoomImagery` then:

- Builds a bbox from the reported globe center and viewport spans.
- Requests `provider.fetchImage({ bbox, date, width, height })`.
- Shows a full-screen 2D image over the canvas.
- Lets drag gestures update the globe center with `focusGlobeAt`.
- Converts image click coordinates back to lat/lon and passes an `imageryView` into `selectPoint`, so the modal can open at a matching regional scale.
- Suppresses itself on scroll-out and returns when max-zoom state is re-entered.

Do not treat max zoom as only visual decoration; it is part of the modal handoff.

## Camera And Drag Tuning

`AdaptiveControls` dynamically adjusts `OrbitControls` speeds from camera distance:

- `zoomSpeed` eases from `MIN_ZOOM_SPEED` near the surface to `MAX_ZOOM_SPEED` at wide globe distance.
- `rotateSpeed` and `panSpeed` use the same distance-aware idea so dragging close to max zoom feels less jumpy.
- When changing these constants, test both almost-max zoom before the detailed overlay loads and full max-zoom overlay drag.

## Overlays And Activity Markers

GIBS analytic overlays are registered with `overlayOnly: true`. `CameraHotkeys.tsx` should keep the overlay add menu filtered to `provider.overlayOnly && provider.layerId`, so base imagery options do not appear as overlays. `Globe.tsx` marks overlay textures as loading when their URL changes, and `Earth.tsx` reports loaded textures back through `onOverlayReady`.

Activity overlays are browser-fetched and intentionally resilient:

- `EarthquakeMarkers.tsx` uses USGS all-day GeoJSON, filters to magnitude 2.5+, colors markers by magnitude, and keeps title/place/time/depth/status/link metadata for hover details.
- `VolcanoMarkers.tsx` uses NASA EONET open volcano events. EONET geometry dates are observation/report dates, not verified last-eruption dates. Volcano markers use the `volcano` X-shape variant so they are visually distinct from earthquake crosshairs.
- `StormTracks.tsx` uses NASA EONET open severe-storm events, renders point history as line segments, and keeps latest/peak intensity, dates, and source links when available.
- `ActivityCrosshair.tsx` renders dark-stroked marker shapes plus invisible square hit targets. If several hit targets overlap, it chooses the marker whose center is closest to the pointer.
- `ActivityHoverPopup.tsx`, `activityHoverStore.ts`, and `eventDetails.ts` own the shared hover popup state and date/recency formatting.

## Common Tasks

For a globe control or hotkey change, start in `CameraHotkeys.tsx` and confirm modal-open guards remain intact.

For camera or zoom behavior, start in `AdaptiveControls` inside `Globe.tsx`, then inspect `MaxZoomImagery.tsx` if the change affects the detailed overlay.

For selection behavior, check both `Earth.tsx` and `MaxZoomImagery.tsx`; the sphere and flat overlay have separate coordinate conversion paths.

For activity overlays, keep browser fetches resilient. Failed feeds should render no markers rather than breaking the globe.

For labels/boundaries, keep `modalOpen` and `atMaxZoom` visibility behavior in mind. City labels intentionally disappear when the modal or max-zoom overlay is active, and should stay behind app UI panels when visible.

## Validation

Run at least:

```bash
npm run lint
```

For visual/camera changes, also run the dev server and inspect:

- regular globe at initial zoom
- max-zoom overlay
- shift-click/right-click modal opening from both sphere and overlay
- imagery panel while modal is closed
- overlay loading indicators and overlay candidate hover summaries
- activity marker hover details, especially overlapping marker selection
- absence of imagery panel/hotkeys while modal is open
