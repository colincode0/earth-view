---
name: earth-view-server-apis
description: Work on Earth View server/API logic. Use when editing or debugging Vite local middleware, Vercel-style API handlers, Copernicus Sentinel auth/image/catalog requests, Sentinel scene search behavior, Ask View OpenAI/Anthropic calls, streaming SSE responses, environment variables, or server-side credential handling.
---

# Earth View Server APIs

Use this skill for changes that cross the browser/server boundary.

## Start Here

Read these files first:

1. `vite.config.ts` for local dev middleware mounted under `/api/*`.
2. `src/server/sentinel.ts` for shared Sentinel auth, Process API rendering, Catalog searches, validation, and token caching.
3. `src/server/askView.ts` for shared Ask View prompt construction, provider calls, streaming, and briefing extraction.
4. `api/*.ts` for Vercel-style wrappers around the shared server functions.
5. `src/providers/SentinelProvider.ts` and `src/components/Modal/AskViewModal.tsx` for browser callers.

## Endpoint Map

Local Vite middleware and deployment handlers expose the same routes:

- `POST /api/sentinel-image`: render a Sentinel PNG through Copernicus Process API.
- `POST /api/sentinel-scenes`: search Sentinel Catalog scenes.
- `POST /api/ask-view`: non-streaming AI view analysis.
- `POST /api/ask-view-stream`: SSE streaming AI view analysis.

Keep shared logic in `src/server/*`; keep `api/*` wrappers thin.

## Sentinel Flow

`src/server/sentinel.ts` handles:

- credential lookup from `COPERNICUS_CLIENT_ID` / `COPERNICUS_CLIENT_SECRET`, with older `SENTINELHUB_*` fallbacks.
- access-token caching.
- request validation.
- bbox conversion to `[minLon, minLat, maxLon, maxLat]`.
- Sentinel Process API request bodies.
- Sentinel Catalog searches.
- Sentinel-2 cloud filtering above 60 percent.
- scene de-duplication by acquisition minute.
- scene geometry/footprint fields used by the modal scene hover overlay.

Important constraints:

- Image width/height are clamped to 256-1024 server-side.
- Scene search limit is clamped to 1-100.
- Lookback is clamped to 1-1825 days.
- Sentinel-1 uses IW, DV polarization, high resolution, orthorectification, `GAMMA0_TERRAIN`, and Lee speckle filtering.
- Sentinel-2 uses `leastCC` mosaicking and `maxCloudCoverage: 60`.

## Ask View Flow

`src/server/askView.ts` supports OpenAI and Anthropic:

- OpenAI uses the Responses API model constant in `OPENAI_MODEL`.
- Anthropic uses the Messages API model constant in `ANTHROPIC_MODEL`.
- Initial requests must include an image data URL.
- Follow-up requests can use chat history plus hidden `VIEW_BRIEFING`.
- Streaming responses hide the briefing section from visible chat deltas.
- Web-search tools are configured when providers support them.

The visible UI is currently disabled in `ImageryModal.tsx` with `ASK_VIEW_VISIBLE = false`. Server endpoints may still be called directly when keys are configured.

## Environment Variables

Expected local/deployment variables:

```bash
COPERNICUS_CLIENT_ID=
COPERNICUS_CLIENT_SECRET=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

Older Sentinel names are still supported:

```bash
SENTINELHUB_CLIENT_ID=
SENTINELHUB_CLIENT_SECRET=
```

Never expose these credentials in client-side code.

## Common Tasks

For a Sentinel image-rendering bug, inspect `SentinelProvider.ts` request shape, then `fetchSentinelImage`.

For a Sentinel scene-list, scene-footprint, or time-lapse bug, inspect `/api/sentinel-scenes`, `fetchSentinelScenes`, `useRegionalImagery.ts`, and `useTimeLapse.ts`.

For local-only endpoint behavior, inspect `vite.config.ts` middleware before touching `api/*`.

For deployment-only behavior, inspect `api/*` wrappers and ensure they pass the same env variables into shared server functions.

For Ask View issues, inspect `AskViewModal.tsx` for browser payload shape and `askView.ts` for validation, prompt construction, provider body, stream parsing, and error handling.

## Validation

Run:

```bash
npm run lint
```

Use external API calls only when the user expects them and credentials/network are available. Without credentials, validate that server errors remain clear and do not break the NASA/GIBS-only app path.
