import { useCallback, useEffect, useRef, useState } from "react";
import { getRecentIsoDates } from "@/lib/dates";
import { getSentinelVariant } from "@/lib/sentinelVariants";
import type { BoundingBox, ImageryProvider } from "@/types/imagery";
import type { TimeLapseFrame } from "../TimeLapseModal";
import {
  addUtcYears,
  isoDateFromDate,
  preloadImage,
  selectEvenlySpacedScenes,
  SENTINEL_FIVE_YEAR_LOOKBACK_DAYS,
  SENTINEL_FRAME_CONCURRENCY,
  SENTINEL_RENDER_SIZE,
  SENTINEL_SCENE_LOOKBACK_DAYS,
  SENTINEL_SCENE_SEARCH_LIMIT,
  SENTINEL_YEAR_SCENE_SAMPLE_SIZE,
  SENTINEL_YEAR_SCENE_SEARCH_LIMIT,
  sentinelTimeLapseBboxKey,
} from "./imageryModalHelpers";
import type {
  ManagedObjectUrl,
  SentinelScene,
  SentinelTimeLapseCacheValue,
  TimeLapseMode,
} from "./types";

type TimeLapseOptions = ManagedObjectUrl & {
  bbox: BoundingBox | null;
  date: string;
  provider: ImageryProvider;
};

export function useTimeLapse({
  bbox,
  date,
  provider,
  createObjectUrl,
  revokeObjectUrl,
}: TimeLapseOptions) {
  const sentinelTimeLapseCacheRef = useRef(new Map<string, SentinelTimeLapseCacheValue>());
  const sentinelTimeLapseScopeRef = useRef<string | null>(null);
  const timeLapseAbortRef = useRef<AbortController | null>(null);
  const [timeLapseOpen, setTimeLapseOpenState] = useState(false);
  const [timeLapseFrames, setTimeLapseFrames] = useState<TimeLapseFrame[]>([]);
  const [timeLapseLoading, setTimeLapseLoading] = useState(false);
  const [timeLapseLoadingProgress, setTimeLapseLoadingProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);
  const [timeLapseError, setTimeLapseError] = useState<string | null>(null);
  const [timeLapseMode, setTimeLapseMode] = useState<TimeLapseMode>(7);

  const clearSentinelTimeLapseCache = useCallback(() => {
    for (const cached of sentinelTimeLapseCacheRef.current.values()) {
      for (const frame of cached.frames) {
        revokeObjectUrl(frame.imageUrl);
      }
    }

    sentinelTimeLapseCacheRef.current.clear();
  }, [revokeObjectUrl]);

  const beginTimeLapseRequest = useCallback(() => {
    timeLapseAbortRef.current?.abort();

    const controller = new AbortController();
    timeLapseAbortRef.current = controller;
    return controller;
  }, []);

  const isCurrentTimeLapseRequest = useCallback(
    (controller: AbortController) =>
      timeLapseAbortRef.current === controller && !controller.signal.aborted,
    [],
  );

  const finishTimeLapseRequest = useCallback((controller: AbortController) => {
    if (timeLapseAbortRef.current === controller) {
      timeLapseAbortRef.current = null;
    }
  }, []);

  const setTimeLapseOpen = useCallback((open: boolean) => {
    if (!open) {
      timeLapseAbortRef.current?.abort();
      timeLapseAbortRef.current = null;
      setTimeLapseLoading(false);
      setTimeLapseLoadingProgress(null);
    }

    setTimeLapseOpenState(open);
  }, []);

  const getRegionalSentinelScope = useCallback(() => {
    if (!bbox || !provider.sentinelVariantId) {
      return null;
    }

    return [
      date,
      provider.id,
      provider.sentinelVariantId,
      sentinelTimeLapseBboxKey(bbox),
    ].join("|");
  }, [bbox, date, provider.id, provider.sentinelVariantId]);

  useEffect(() => {
    const nextScope = getRegionalSentinelScope();

    if (sentinelTimeLapseScopeRef.current === nextScope) {
      return;
    }

    sentinelTimeLapseScopeRef.current = nextScope;
    clearSentinelTimeLapseCache();
  }, [
    clearSentinelTimeLapseCache,
    getRegionalSentinelScope,
  ]);

  useEffect(
    () => () => {
      timeLapseAbortRef.current?.abort();
    },
    [],
  );

  async function loadTimeLapse(dayCount: 7 | 30) {
    if (!bbox) {
      return;
    }

    const controller = beginTimeLapseRequest();
    const frameDates = getRecentIsoDates(date, dayCount);
    setTimeLapseMode(dayCount);
    setTimeLapseOpen(true);
    setTimeLapseFrames([]);
    setTimeLapseError(null);
    setTimeLapseLoadingProgress(null);
    setTimeLapseLoading(true);

    const frames = await Promise.allSettled(
      frameDates.map(async (frameDate) => {
        const result = await provider.fetchImage({
          bbox,
          date: frameDate,
          signal: controller.signal,
          width: 1024,
          height: 1024,
        });
        const imageUrl = typeof result === "string" ? result : createObjectUrl(result);

        await preloadImage(imageUrl);

        return {
          date: frameDate,
          imageUrl,
        };
      }),
    );
    const loadedFrames = frames
      .filter((frame): frame is PromiseFulfilledResult<TimeLapseFrame> => frame.status === "fulfilled")
      .map((frame) => frame.value);

    if (!isCurrentTimeLapseRequest(controller)) {
      return;
    }

    setTimeLapseFrames(loadedFrames);
    setTimeLapseLoading(false);
    setTimeLapseLoadingProgress(null);
    finishTimeLapseRequest(controller);

    if (loadedFrames.length === 0) {
      setTimeLapseError(`No imagery frames were available for this ${dayCount}-day view.`);
    } else if (loadedFrames.length < frameDates.length) {
      setTimeLapseError("Some daily frames were unavailable, so the sequence is partial.");
    }
  }

  async function fetchSentinelScenesForWindow(
    sentinelBbox: BoundingBox,
    variantId: string,
    windowDate: string,
    limit: number,
    lookbackDays: number,
    signal: AbortSignal,
  ) {
    const scenesResponse = await fetch("/api/sentinel-scenes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        bbox: sentinelBbox,
        date: windowDate,
        variantId,
        limit,
        lookbackDays,
      }),
      signal,
    });

    if (!scenesResponse.ok) {
      let message = "Sentinel scene search failed.";

      try {
        const body = (await scenesResponse.json()) as { error?: string };
        message = body.error ?? message;
      } catch {
        message = await scenesResponse.text();
      }

      throw new Error(message);
    }

    const { scenes } = (await scenesResponse.json()) as { scenes?: SentinelScene[] };
    return scenes ?? [];
  }

  async function renderSentinelTimeLapseFrames(
    scenes: SentinelScene[],
    requestedCount: number,
    cacheKey: string | null,
    renderTarget: { bbox: BoundingBox; variantId: string },
    controller: AbortController,
  ) {
    const variant = getSentinelVariant(renderTarget.variantId);
    const activeBbox = renderTarget.bbox;
    const distinctSceneDates = new Map<string, SentinelScene>();
    const seenSceneDateTimes = new Set<string>();
    scenes
      .filter((scene) => {
        if (seenSceneDateTimes.has(scene.dateTime)) {
          return false;
        }

        seenSceneDateTimes.add(scene.dateTime);
        return true;
      })
      .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())
      .forEach((scene) => {
        distinctSceneDates.set(isoDateFromDate(new Date(scene.dateTime)), scene);
      });
    const scenesToRender = Array.from(distinctSceneDates.values()).slice(-requestedCount);

    if (distinctSceneDates.size === 0) {
      const nextError = `No distinct ${variant.name} scenes were found for this view.`;
      setTimeLapseFrames([]);
      setTimeLapseLoading(false);
      setTimeLapseLoadingProgress(null);
      setTimeLapseError(nextError);

      if (cacheKey) {
        sentinelTimeLapseCacheRef.current.set(cacheKey, {
          frames: [],
          error: nextError,
        });
      }

      return;
    }

    setTimeLapseLoadingProgress({ loaded: 0, total: scenesToRender.length });

    const loadedSceneFrames: TimeLapseFrame[] = [];
    let completedSceneRequests = 0;
    let nextSceneIndex = 0;

    async function renderNextScene() {
      while (nextSceneIndex < scenesToRender.length) {
        const scene = scenesToRender[nextSceneIndex];
        const frameDate = isoDateFromDate(new Date(scene.dateTime));
        nextSceneIndex += 1;

        try {
          const response = await fetch("/api/sentinel-image", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              bbox: activeBbox,
              date: frameDate,
              variantId: variant.id,
              width: SENTINEL_RENDER_SIZE,
              height: SENTINEL_RENDER_SIZE,
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`${variant.name} imagery is unavailable for ${scene.dateTime}.`);
          }

          const imageUrl = createObjectUrl(await response.blob());
          await preloadImage(imageUrl);

          const frame = {
            date: frameDate,
            imageUrl,
          };

          loadedSceneFrames.push(frame);
          loadedSceneFrames.sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
          );
          if (isCurrentTimeLapseRequest(controller)) {
            setTimeLapseFrames([...loadedSceneFrames]);
          }
        } finally {
          completedSceneRequests += 1;
          if (isCurrentTimeLapseRequest(controller)) {
            setTimeLapseLoadingProgress({
              loaded: completedSceneRequests,
              total: scenesToRender.length,
            });
          }
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(SENTINEL_FRAME_CONCURRENCY, scenesToRender.length) },
        renderNextScene,
      ),
    );

    if (!isCurrentTimeLapseRequest(controller)) {
      return;
    }

    setTimeLapseFrames(loadedSceneFrames);
    setTimeLapseLoading(false);
    setTimeLapseLoadingProgress(null);

    let nextError: string | null = null;

    if (loadedSceneFrames.length === 0) {
      nextError = `No ${variant.name} mosaic frames were available for this view.`;
    } else if (loadedSceneFrames.length < scenesToRender.length) {
      nextError = "Some Sentinel mosaic frames were unavailable, so the sequence is partial.";
    } else if (loadedSceneFrames.length < requestedCount) {
      nextError = `Only ${loadedSceneFrames.length} distinct mosaic dates were found in the latest available imagery.`;
    }

    setTimeLapseError(nextError);

    if (cacheKey) {
      sentinelTimeLapseCacheRef.current.set(cacheKey, {
        frames: loadedSceneFrames,
        error: nextError,
      });
    }

    finishTimeLapseRequest(controller);
  }

  async function loadRegionalSentinelTimeLapse(dayCount: 7 | 30) {
    if (!bbox || !provider.sentinelVariantId) {
      return;
    }

    const controller = beginTimeLapseRequest();
    const variant = getSentinelVariant(provider.sentinelVariantId);
    const cacheScope = getRegionalSentinelScope();
    const cacheKey = cacheScope ? `${cacheScope}|${dayCount}` : null;
    const cached = cacheKey ? sentinelTimeLapseCacheRef.current.get(cacheKey) : undefined;

    setTimeLapseMode(dayCount);
    setTimeLapseOpen(true);

    if (cached) {
      setTimeLapseFrames(cached.frames);
      setTimeLapseError(cached.error);
      setTimeLapseLoading(false);
      setTimeLapseLoadingProgress(null);
      finishTimeLapseRequest(controller);
      return;
    }

    setTimeLapseFrames([]);
    setTimeLapseError(null);
    setTimeLapseLoadingProgress(null);
    setTimeLapseLoading(true);

    try {
      const scenes = await fetchSentinelScenesForWindow(
        bbox,
        variant.id,
        date,
        SENTINEL_SCENE_SEARCH_LIMIT,
        SENTINEL_SCENE_LOOKBACK_DAYS,
        controller.signal,
      );
      await renderSentinelTimeLapseFrames(scenes, dayCount, cacheKey, {
        bbox,
        variantId: variant.id,
      }, controller);
    } catch (sceneError) {
      if (!isCurrentTimeLapseRequest(controller)) {
        return;
      }

      setTimeLapseFrames([]);
      setTimeLapseLoading(false);
      setTimeLapseLoadingProgress(null);
      setTimeLapseError(
        sceneError instanceof Error ? sceneError.message : "Sentinel scene search failed.",
      );
    } finally {
      finishTimeLapseRequest(controller);
    }
  }

  async function loadRegionalSentinelFiveYearTimeLapse() {
    if (!bbox || !provider.sentinelVariantId) {
      return;
    }

    const controller = beginTimeLapseRequest();
    const variant = getSentinelVariant(provider.sentinelVariantId);
    const cacheScope = getRegionalSentinelScope();
    const cacheKey = cacheScope ? `${cacheScope}|5y` : null;
    const cached = cacheKey ? sentinelTimeLapseCacheRef.current.get(cacheKey) : undefined;

    setTimeLapseMode("5y");
    setTimeLapseOpen(true);

    if (cached) {
      setTimeLapseFrames(cached.frames);
      setTimeLapseError(cached.error);
      setTimeLapseLoading(false);
      setTimeLapseLoadingProgress(null);
      finishTimeLapseRequest(controller);
      return;
    }

    setTimeLapseFrames([]);
    setTimeLapseError(null);
    setTimeLapseLoadingProgress(null);
    setTimeLapseLoading(true);

    try {
      const endDate = new Date(`${date}T23:59:59Z`);
      const selectedScenes: SentinelScene[] = [];

      for (let index = 4; index >= 0; index -= 1) {
        const windowEndDate = addUtcYears(endDate, -index);
        const scenes = await fetchSentinelScenesForWindow(
          bbox,
          variant.id,
          isoDateFromDate(windowEndDate),
          SENTINEL_YEAR_SCENE_SEARCH_LIMIT,
          SENTINEL_FIVE_YEAR_LOOKBACK_DAYS,
          controller.signal,
        );

        selectedScenes.push(
          ...selectEvenlySpacedScenes(scenes, SENTINEL_YEAR_SCENE_SAMPLE_SIZE),
        );
      }

      await renderSentinelTimeLapseFrames(
        selectedScenes,
        SENTINEL_YEAR_SCENE_SAMPLE_SIZE * 5,
        cacheKey,
        {
          bbox,
          variantId: variant.id,
        },
        controller,
      );
    } catch (sceneError) {
      if (!isCurrentTimeLapseRequest(controller)) {
        return;
      }

      setTimeLapseFrames([]);
      setTimeLapseLoading(false);
      setTimeLapseLoadingProgress(null);
      setTimeLapseError(
        sceneError instanceof Error ? sceneError.message : "Sentinel scene search failed.",
      );
    } finally {
      finishTimeLapseRequest(controller);
    }
  }

  return {
    timeLapseOpen,
    timeLapseFrames,
    timeLapseLoading,
    timeLapseLoadingProgress,
    timeLapseError,
    timeLapseMode,
    setTimeLapseOpen,
    loadTimeLapse,
    loadRegionalSentinelTimeLapse,
    loadRegionalSentinelFiveYearTimeLapse,
  };
}
