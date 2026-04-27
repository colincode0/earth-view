import {
  type PointerEvent,
  type RefObject,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  bboxFromPoint,
  clamp,
  degreesToZoomPercent,
  normalizeLongitude,
  zoomPercentToDegrees,
} from "@/lib/geo";
import { getSentinelVariant } from "@/lib/sentinelVariants";
import type { ImageryProvider } from "@/types/imagery";
import {
  bboxFromSpans,
  preloadImage,
} from "./imageryModalHelpers";
import type { ManagedObjectUrl } from "./types";

export type SceneAcquisition = {
  dateTime: string;
  cloudCover: number | null;
};

type CachedRegionalImage = {
  imageUrl: string;
  scenes: SceneAcquisition[];
};

type SentinelSceneResponse = {
  scenes?: Array<{
    dateTime: string;
    cloudCover?: number | null;
  }>;
  error?: string;
};

const REGIONAL_SCENES_LIMIT = 30;

function imageryErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Imagery unavailable for this selection.";
}

function bboxCacheKey(bbox: {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}) {
  return [
    bbox.minLat,
    bbox.minLon,
    bbox.maxLat,
    bbox.maxLon,
  ]
    .map((value) => value.toFixed(5))
    .join(",");
}

type SelectedPoint = {
  lat: number;
  lon: number;
  imageryView?: {
    latSpan: number;
    lonSpan: number;
    pixelWidth: number;
    pixelHeight: number;
  };
};

type RegionalImageryOptions = ManagedObjectUrl & {
  selectedPoint: SelectedPoint | null;
  modalOpen: boolean;
  date: string;
  provider: ImageryProvider;
  imageryZoomDegrees: number;
  imagePaneRef: RefObject<HTMLDivElement | null>;
  imagePaneSize: { width: number; height: number } | null;
  setImageryZoomDegrees: (value: number) => void;
  recenterPoint: (lat: number, lon: number) => void;
};

export function useRegionalImagery({
  selectedPoint,
  modalOpen,
  date,
  provider,
  imageryZoomDegrees,
  imagePaneRef,
  imagePaneSize,
  setImageryZoomDegrees,
  recenterPoint,
  createObjectUrl,
}: RegionalImageryOptions) {
  const imageScopeRef = useRef<string | null>(null);
  const imageCacheRef = useRef(new Map<string, CachedRegionalImage>());
  const wasModalOpenRef = useRef(false);
  const zoomCommitTimerRef = useRef<number | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  const updateReasonRef = useRef<"positioning" | "resolution" | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [acquiredScenes, setAcquiredScenes] = useState<SceneAcquisition[]>([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewZoomDegrees, setPreviewZoomDegrees] = useState(imageryZoomDegrees);
  const [loadedImageZoomDegrees, setLoadedImageZoomDegrees] = useState(imageryZoomDegrees);
  const [regionalPan, setRegionalPan] = useState({ x: 0, y: 0 });
  const [committedRegionalPan, setCommittedRegionalPan] = useState({ x: 0, y: 0 });
  const [updateReason, setUpdateReason] = useState<"positioning" | "resolution" | null>(null);
  const [regionalDragStart, setRegionalDragStart] = useState<{
    pointerId: number;
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);

  const selectedLat = selectedPoint?.lat;
  const selectedLon = selectedPoint?.lon;
  const hasImageryView = Boolean(selectedPoint?.imageryView);
  const bbox = useMemo(() => {
    if (!selectedPoint) {
      return null;
    }

    if (selectedPoint.imageryView) {
      const paneSize = imagePaneSize ?? {
        width: selectedPoint.imageryView.pixelWidth,
        height: selectedPoint.imageryView.pixelHeight,
      };

      const zoomScale = imageryZoomDegrees / selectedPoint.imageryView.lonSpan;

      return bboxFromSpans(
        selectedPoint.lat,
        selectedPoint.lon,
        selectedPoint.imageryView.latSpan *
          zoomScale *
          (paneSize.height / selectedPoint.imageryView.pixelHeight),
        selectedPoint.imageryView.lonSpan *
          zoomScale *
          (paneSize.width / selectedPoint.imageryView.pixelWidth),
      );
    }

    return bboxFromPoint(selectedPoint.lat, selectedPoint.lon, imageryZoomDegrees);
  }, [imagePaneSize, imageryZoomDegrees, selectedPoint]);
  const fallbackBbox = useMemo(() => {
    if (!selectedPoint) {
      return null;
    }

    return bboxFromPoint(selectedPoint.lat, selectedPoint.lon, imageryZoomDegrees);
  }, [imageryZoomDegrees, selectedPoint]);
  const regionalImageWidth = imagePaneSize
    ? Math.min(1400, Math.max(768, Math.round(imagePaneSize.width)))
    : 1024;
  const regionalImageHeight = imagePaneSize
    ? Math.min(1400, Math.max(768, Math.round(imagePaneSize.height)))
    : 1024;
  const imagePreviewScale = loadedImageZoomDegrees / previewZoomDegrees;

  const setManagedImage = useCallback((image: CachedRegionalImage | null) => {
    imageUrlRef.current = image?.imageUrl ?? null;
    setImageUrl(image?.imageUrl ?? null);
    setAcquiredScenes(image?.scenes ?? []);
  }, []);

  const setManagedUpdateReason = useCallback((reason: "positioning" | "resolution" | null) => {
    updateReasonRef.current = reason;
    setUpdateReason(reason);
  }, []);

  useEffect(() => {
    if (!modalOpen || !bbox) {
      return;
    }

    let cancelled = false;
    const requestZoomDegrees = imageryZoomDegrees;
    const nextImageScope = [
      selectedLat?.toFixed(5),
      selectedLon?.toFixed(5),
      date,
      provider.id,
    ].join("|");
    const shouldPreserveImageWhileLoading =
      Boolean(provider.sentinelVariantId) &&
      updateReasonRef.current !== null &&
      imageUrlRef.current !== null;
    const cacheKey = [
      provider.id,
      date,
      regionalImageWidth,
      regionalImageHeight,
      bboxCacheKey(bbox),
    ].join("|");
    const cachedImageUrl = imageCacheRef.current.get(cacheKey);

    if (imageScopeRef.current !== nextImageScope) {
      if (!shouldPreserveImageWhileLoading && !cachedImageUrl) {
        setManagedImage(null);
        setRegionalPan({ x: 0, y: 0 });
        setCommittedRegionalPan({ x: 0, y: 0 });
      }

      imageScopeRef.current = nextImageScope;
    }

    if (cachedImageUrl) {
      setManagedImage(cachedImageUrl);
      setLoadedImageZoomDegrees(requestZoomDegrees);
      setPreviewZoomDegrees(requestZoomDegrees);
      setRegionalPan({ x: 0, y: 0 });
      setCommittedRegionalPan({ x: 0, y: 0 });
      setImageLoading(false);
      setError(null);
      setRegionalDragStart(null);
      setManagedUpdateReason(null);
      return;
    }

    setImageLoading(true);
    setError(null);
    setRegionalDragStart(null);

    async function resolveContributingScenes(
      requestBbox: NonNullable<typeof bbox>,
    ): Promise<SceneAcquisition[]> {
      if (!provider.sentinelVariantId) {
        return [];
      }

      const variant = getSentinelVariant(provider.sentinelVariantId);
      const response = await fetch("/api/sentinel-scenes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          bbox: requestBbox,
          date,
          variantId: variant.id,
          limit: REGIONAL_SCENES_LIMIT,
          lookbackDays: variant.requestWindowDays,
        }),
      });

      if (!response.ok) {
        return [];
      }

      const body = (await response.json()) as SentinelSceneResponse;
      return (body.scenes ?? [])
        .filter((scene): scene is { dateTime: string; cloudCover?: number | null } =>
          Boolean(scene.dateTime),
        )
        .map((scene) => ({
          dateTime: scene.dateTime,
          cloudCover: scene.cloudCover ?? null,
        }));
    }

    async function loadRegionalImage(requestBbox: NonNullable<typeof bbox>) {
      const [result, scenes] = await Promise.all([
        provider.fetchImage({
          bbox: requestBbox,
          date,
          width: regionalImageWidth,
          height: regionalImageHeight,
        }),
        resolveContributingScenes(requestBbox).catch(() => [] as SceneAcquisition[]),
      ]);
      const nextImageUrl = typeof result === "string" ? result : createObjectUrl(result);
      await preloadImage(nextImageUrl);

      return {
        imageUrl: nextImageUrl,
        scenes,
      };
    }

    loadRegionalImage(bbox)
      .then(async (result) => {
        if (cancelled) {
          return;
        }

        setManagedImage(result);
        imageCacheRef.current.set(cacheKey, result);
        setLoadedImageZoomDegrees(requestZoomDegrees);
        setPreviewZoomDegrees(requestZoomDegrees);
        setRegionalPan({ x: 0, y: 0 });
        setCommittedRegionalPan({ x: 0, y: 0 });
        setImageLoading(false);
        setManagedUpdateReason(null);
      })
      .catch(async (error: unknown) => {
        if (!hasImageryView || !fallbackBbox) {
          if (!cancelled) {
            setError(imageryErrorMessage(error));
            setImageLoading(false);
            setManagedUpdateReason(null);
          }

          return;
        }

        try {
          const fallbackImageUrl = await loadRegionalImage(fallbackBbox);

          if (!cancelled) {
            setManagedImage(fallbackImageUrl);
            imageCacheRef.current.set(cacheKey, fallbackImageUrl);
            setLoadedImageZoomDegrees(requestZoomDegrees);
            setPreviewZoomDegrees(requestZoomDegrees);
            setRegionalPan({ x: 0, y: 0 });
            setCommittedRegionalPan({ x: 0, y: 0 });
            setImageLoading(false);
            setManagedUpdateReason(null);
          }
        } catch {
          if (!cancelled) {
            setError(imageryErrorMessage(error));
            setImageLoading(false);
            setManagedUpdateReason(null);
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    bbox,
    createObjectUrl,
    date,
    fallbackBbox,
    hasImageryView,
    imageryZoomDegrees,
    modalOpen,
    provider,
    regionalImageHeight,
    regionalImageWidth,
    selectedLat,
    selectedLon,
    setManagedImage,
    setManagedUpdateReason,
  ]);

  useEffect(() => {
    if (modalOpen && !wasModalOpenRef.current) {
      setPreviewZoomDegrees(imageryZoomDegrees);
      setLoadedImageZoomDegrees(imageryZoomDegrees);
    }

    wasModalOpenRef.current = modalOpen;
  }, [imageryZoomDegrees, modalOpen]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current !== null) {
        window.clearTimeout(zoomCommitTimerRef.current);
      }
    };
  }, []);

  function pointFromRegionalEvent(event: PointerEvent<HTMLImageElement>) {
    if (!bbox || !selectedPoint) {
      return null;
    }

    const rect = imagePaneRef.current?.getBoundingClientRect();

    if (!rect) {
      return null;
    }

    const scale = imagePreviewScale || 1;
    const baseX = (event.clientX - rect.left - rect.width / 2 - regionalPan.x) / scale;
    const baseY = (event.clientY - rect.top - rect.height / 2 - regionalPan.y) / scale;
    const lonSpan = bbox.maxLon - bbox.minLon;
    const latSpan = bbox.maxLat - bbox.minLat;

    return {
      lat: clamp(selectedPoint.lat - (baseY / rect.height) * latSpan, -85, 85),
      lon: normalizeLongitude(selectedPoint.lon + (baseX / rect.width) * lonSpan),
    };
  }

  function commitRegionalPan(nextPan = regionalPan) {
    if (!bbox || !selectedPoint) {
      setRegionalPan({ x: 0, y: 0 });
      return;
    }

    const rect = imagePaneRef.current?.getBoundingClientRect();

    if (!rect || (Math.abs(nextPan.x) < 4 && Math.abs(nextPan.y) < 4)) {
      setRegionalPan({ x: 0, y: 0 });
      return;
    }

    const scale = imagePreviewScale || 1;
    const lonSpan = (bbox.maxLon - bbox.minLon) / scale;
    const latSpan = (bbox.maxLat - bbox.minLat) / scale;
    const nextLat = clamp(selectedPoint.lat + (nextPan.y / rect.height) * latSpan, -85, 85);
    const nextLon = normalizeLongitude(selectedPoint.lon - (nextPan.x / rect.width) * lonSpan);

    setCommittedRegionalPan(nextPan);
    setRegionalPan(nextPan);
    setManagedUpdateReason("positioning");
    recenterPoint(nextLat, nextLon);
  }

  function previewRegionalZoom(nextDegrees: number) {
    setPreviewZoomDegrees(nextDegrees);
    setManagedUpdateReason("resolution");

    if (zoomCommitTimerRef.current !== null) {
      window.clearTimeout(zoomCommitTimerRef.current);
    }

    zoomCommitTimerRef.current = window.setTimeout(() => {
      setImageryZoomDegrees(nextDegrees);
      zoomCommitTimerRef.current = null;
    }, 260);
  }

  function zoomRegionalImage(event: WheelEvent<HTMLImageElement>) {
    event.preventDefault();

    const currentPercent = degreesToZoomPercent(previewZoomDegrees);
    const nextPercent = clamp(currentPercent + (event.deltaY > 0 ? -1 : 1), 0, 100);

    previewRegionalZoom(zoomPercentToDegrees(nextPercent));
  }

  return {
    bbox,
    acquiredScenes,
    imagePreviewScale,
    imageUrl,
    imageLoading,
    error,
    regionalPan,
    committedRegionalPan,
    regionalDragStart,
    updateReason,
    setError,
    setImageLoading,
    setRegionalDragStart,
    setRegionalPan,
    pointFromRegionalEvent,
    commitRegionalPan,
    zoomRegionalImage,
  };
}
