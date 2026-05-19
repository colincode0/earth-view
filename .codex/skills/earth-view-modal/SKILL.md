---
name: earth-view-modal
description: Work on Earth View's regional modal workspace. Use when editing or debugging ImageryModal, modal pan/zoom/recenter behavior, regional image loading, Sentinel scene display, date/layer controls, imagery info dialog, time-lapse modal, GIF export, Ask View UI plumbing, or modal state restoration.
---

# Earth View Modal

Use this skill for changes inside the regional inspection workspace opened from the globe.

## Start Here

Read these files first, in this order:

1. `src/components/Modal/ImageryModal.tsx` for layout, controls, and high-level orchestration.
2. `src/components/Modal/hooks/useRegionalImagery.ts` for bbox calculation, image loading, caching, pan/zoom, and Sentinel scene lookup.
3. `src/components/Modal/hooks/useTimeLapse.ts` for GIBS and Sentinel time-lapse behavior.
4. `src/store/useAppStore.ts` for selected point, modal open/close, modal return state, and imagery zoom.
5. `src/providers/registry.ts` to understand layer ordering and provider capabilities.

## Mental Model

Treat the modal as the detailed regional workspace. It receives a selected point from the globe, computes a regional bbox, renders one image at a time, and provides layer/date/time-lapse tools in the sidebar.

The modal temporarily changes global app state. On first open, `selectPoint` stores `modalReturnState` with prior date, layer, manual-selection flags, and overlay stack. `closeModal` restores that state.

## Core Files

- `src/components/Modal/ImageryModal.tsx`: dialog layout, image pane, sidebar, provider metadata, scene list and scene footprint hover, time-lapse buttons, layer/date controls, hidden Ask View gate.
- `src/components/Modal/hooks/useRegionalImagery.ts`: bbox math, preview zoom, drag/pan commit, image cache, Sentinel scene lookup, Sentinel scene geometries, fallback bbox behavior.
- `src/components/Modal/hooks/useTimeLapse.ts`: daily GIBS sequences, Sentinel scene search, Sentinel render concurrency, five-year sampled comparison, time-lapse cache.
- `src/components/Modal/TimeLapseModal.tsx`: playback UI, frame list, animated GIF export.
- `src/components/Modal/LayerSwitcher.tsx`: modal provider list, Sentinel-first order via `modalImageryProviders`.
- `src/components/Modal/DatePicker.tsx`: date bounds.
- `src/components/Modal/ImageryInfoModal.tsx`: provider metadata display.
- `src/components/Modal/AskViewModal.tsx`: AI chat UI, currently hidden by `ASK_VIEW_VISIBLE = false`.
- `src/components/Modal/hooks/imageryModalHelpers.ts`: bbox helpers and Sentinel time-lapse constants.

## Interaction Rules

Preserve these behaviors unless the user asks to change them:

- Drag pans the regional image and commits a new selected center on pointer up.
- Scroll zooms by updating preview zoom immediately, then committing `imageryZoomDegrees` after a short delay.
- Pending zoom commits are flushed before drag/recenter commits, and retained pan is rescaled when preview zoom changes. This keeps rapid zoom/drag/zoom sequences from anchoring on stale loaded imagery.
- Shift-click recenters without leaving the modal.
- Number keys switch modal layers unless the user is typing in an input-like element.
- Existing imagery can remain visible while Sentinel positioning/resolution updates are pending.
- The modal image uses `object-cover` and transform-based pan/scale; avoid layout shifts while loading.

## Sentinel Modal Details

For Sentinel providers:

- `useRegionalImagery` fetches `/api/sentinel-scenes` for contributing scenes and `/api/sentinel-image` through the provider.
- The sidebar lists scene acquisitions only when more than one scene contributes.
- Scene rows can expose Sentinel scene geometries. Hover/focus scene rows in `ImageryModal.tsx` may draw a green footprint overlay over the mosaic so users can connect mosaic regions to contributing scenes.
- Capture labels prefer exact scene acquisition times when scene data exists.
- Interaction-triggered Sentinel reloads are delayed by `SENTINEL_INTERACTION_LOAD_DELAY_MS`.
- Time lapses use scene searches, distinct scene dates, limited render concurrency, and cached frames.

For GIBS providers:

- Images are WMS URL strings, not blobs.
- Daily time lapses use recent ISO dates and `provider.fetchImage` directly.

## Ask View Caveat

`AskViewModal.tsx` and `/api/ask-view*` exist, but the visible modal UI is disabled by:

```ts
const ASK_VIEW_VISIBLE = false;
```

Do not document or assume Ask View as user-facing unless enabling that flag is part of the task.

## Common Tasks

For a modal layout/control change, edit `ImageryModal.tsx` first, then move behavior into hooks only when stateful logic is involved.

For pan, zoom, selection, or bbox changes, work in `useRegionalImagery.ts` and check how max-zoom `imageryView` from `MaxZoomImagery` affects `bboxForPoint`.

For scene footprint display, check both the `/api/sentinel-scenes` response shape and the modal overlay math. Scene geometry coordinates should flow through `useRegionalImagery.ts` and be projected in `ImageryModal.tsx`; avoid guessing footprints from scene timestamps alone.

For time-lapse changes, work in `useTimeLapse.ts` and `TimeLapseModal.tsx`; keep GIBS daily sequences and Sentinel scene sequences separate.

For layer list changes, prefer changing provider metadata/order in `src/providers/registry.ts` rather than hard-coding modal UI behavior.

## Validation

Run at least:

```bash
npm run lint
```

For user-facing modal changes, manually inspect:

- modal opening from globe and max-zoom overlay
- drag pan, scroll zoom, shift-click recenter
- rapid scroll/drag/scroll sequences while a regional image reload is pending
- date picker and layer switching
- Sentinel scene list hover/focus footprint overlay when multiple scenes contribute
- GIBS 7-day/30-day time lapse
- Sentinel layer load/error state if credentials are available
- Sentinel GIF export if time-lapse behavior changed
