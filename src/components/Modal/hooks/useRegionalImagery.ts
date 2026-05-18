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
import type { ImageryProvider, SentinelSceneGeometry } from "@/types/imagery";
import {
  bboxFromSpans,
  preloadImage,
} from "./imageryModalHelpers";
import type { ManagedObjectUrl } from "./types";

export type SceneAcquisition = {
  dateTime: string;
  cloudCover: number | null;
  geometries: SentinelSceneGeometry[];
};

type CachedRegionalImage = {
  imageUrl: string;
  scenes: SceneAcquisition[];
};

type SentinelSceneResponse = {
  scenes?: Array<{
    dateTime: string;
    cloudCover?: number | null;
    geometries?: SentinelSceneGeometry[];
  }>;
  error?: string;
};

const REGIONAL_SCENES_LIMIT = 30;
const SENTINEL_INTERACTION_LOAD_DELAY_MS = 500;

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

type RegionalDragStart = {
  pointerId: number;
  x: number;
  y: number;
  originX: number;
  originY: number;
  centerLat: number;
  centerLon: number;
  latSpan: number;
  lonSpan: number;
};

type RegionalDragStartInput = Pick<
  RegionalDragStart,
  "pointerId" | "x" | "y" | "originX" | "originY"
>;

function bboxForPoint(
  selectedPoint: SelectedPoint,
  imagePaneSize: { width: number; height: number } | null,
  zoomDegrees: number,
) {
  if (selectedPoint.imageryView) {
    const paneSize = imagePaneSize ?? {
      width: selectedPoint.imageryView.pixelWidth,
      height: selectedPoint.imageryView.pixelHeight,
    };
    const zoomScale = zoomDegrees / selectedPoint.imageryView.lonSpan;

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

  return bboxFromPoint(selectedPoint.lat, selectedPoint.lon, zoomDegrees);
}

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
  const requestVersionRef = useRef(0);
  const dragInvalidatedRequestRef = useRef(false);
  const dragActiveRef = useRef(false);
  const updateReasonRef = useRef<"positioning" | "resolution" | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [acquiredScenes, setAcquiredScenes] = useState<SceneAcquisition[]>([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [requestNonce, setRequestNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewZoomDegrees, setPreviewZoomDegrees] = useState(imageryZoomDegrees);
  const [loadedImageZoomDegrees, setLoadedImageZoomDegrees] = useState(imageryZoomDegrees);
  const [regionalPan, setRegionalPan] = useState({ x: 0, y: 0 });
  const [committedRegionalPan, setCommittedRegionalPan] = useState({ x: 0, y: 0 });
  const [updateReason, setUpdateReason] = useState<"positioning" | "resolution" | null>(null);
  const [regionalDragStart, setRegionalDragStart] = useState<RegionalDragStart | null>(null);

  const selectedLat = selectedPoint?.lat;
  const selectedLon = selectedPoint?.lon;
  const hasImageryView = Boolean(selectedPoint?.imageryView);
  const bbox = useMemo(() => {
    if (!selectedPoint) {
      return null;
    }

    return bboxForPoint(selectedPoint, imagePaneSize, imageryZoomDegrees);
  }, [imagePaneSize, imageryZoomDegrees, selectedPoint]);
  const previewBbox = useMemo(() => {
    if (!selectedPoint) {
      return null;
    }

    return bboxForPoint(selectedPoint, imagePaneSize, previewZoomDegrees);
  }, [imagePaneSize, previewZoomDegrees, selectedPoint]);
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

  const invalidatePendingImageRequest = useCallback(() => {
    requestVersionRef.current += 1;
  }, []);

  const restartCurrentImageRequest = useCallback(() => {
    invalidatePendingImageRequest();
    setRequestNonce((nonce) => nonce + 1);
  }, [invalidatePendingImageRequest]);

  useEffect(() => {
    if (!modalOpen || !bbox) {
      return;
    }

    if (dragActiveRef.current) {
      return;
    }

    let cancelled = false;
    let loadTimer: number | null = null;
    const requestVersion = requestVersionRef.current;
    const requestZoomDegrees = imageryZoomDegrees;
    const requestBbox = bbox;
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
        .filter((scene): scene is {
          dateTime: string;
          cloudCover?: number | null;
          geometries?: SentinelSceneGeometry[];
        } =>
          Boolean(scene.dateTime),
        )
        .map((scene) => ({
          dateTime: scene.dateTime,
          cloudCover: scene.cloudCover ?? null,
          geometries: scene.geometries ?? [],
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

    function loadLatestRegionalImage() {
      if (cancelled || dragActiveRef.current || requestVersion !== requestVersionRef.current) {
        return;
      }

      loadRegionalImage(requestBbox)
        .then(async (result) => {
          if (cancelled || dragActiveRef.current || requestVersion !== requestVersionRef.current) {
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
          if (cancelled || dragActiveRef.current || requestVersion !== requestVersionRef.current) {
            return;
          }

          if (!hasImageryView || !fallbackBbox) {
            setError(imageryErrorMessage(error));
            setImageLoading(false);
            setManagedUpdateReason(null);

            return;
          }

          try {
            const fallbackImageUrl = await loadRegionalImage(fallbackBbox);

            if (!cancelled && !dragActiveRef.current && requestVersion === requestVersionRef.current) {
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
            if (!cancelled && !dragActiveRef.current && requestVersion === requestVersionRef.current) {
              setError(imageryErrorMessage(error));
              setImageLoading(false);
              setManagedUpdateReason(null);
            }
          }
        });
    }

    if (provider.sentinelVariantId && updateReasonRef.current !== null) {
      loadTimer = window.setTimeout(loadLatestRegionalImage, SENTINEL_INTERACTION_LOAD_DELAY_MS);
    } else {
      loadLatestRegionalImage();
    }

    return () => {
      cancelled = true;
      if (loadTimer !== null) {
        window.clearTimeout(loadTimer);
      }
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
    requestNonce,
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

  function pointFromRegionalEvent(event: PointerEvent<HTMLElement>) {
    if (!previewBbox || !selectedPoint) {
      return null;
    }

    const rect = imagePaneRef.current?.getBoundingClientRect();

    if (!rect) {
      return null;
    }

    const baseX = event.clientX - rect.left - rect.width / 2 - regionalPan.x;
    const baseY = event.clientY - rect.top - rect.height / 2 - regionalPan.y;
    const lonSpan = previewBbox.maxLon - previewBbox.minLon;
    const latSpan = previewBbox.maxLat - previewBbox.minLat;

    return {
      lat: clamp(selectedPoint.lat - (baseY / rect.height) * latSpan, -85, 85),
      lon: normalizeLongitude(selectedPoint.lon + (baseX / rect.width) * lonSpan),
    };
  }

  function commitRegionalPan(nextPan = regionalPan) {
    if (!selectedPoint) {
      dragActiveRef.current = false;
      setRegionalPan({ x: 0, y: 0 });

      if (dragInvalidatedRequestRef.current) {
        dragInvalidatedRequestRef.current = false;
        restartCurrentImageRequest();
      }

      return;
    }

    const rect = imagePaneRef.current?.getBoundingClientRect();
    const dragStart = regionalDragStart;

    if (!rect || (Math.abs(nextPan.x) < 4 && Math.abs(nextPan.y) < 4)) {
      dragActiveRef.current = false;
      setRegionalPan({ x: 0, y: 0 });

      if (dragInvalidatedRequestRef.current) {
        dragInvalidatedRequestRef.current = false;
        restartCurrentImageRequest();
      }

      return;
    }

    const fallbackPreviewBbox = previewBbox ?? bboxForPoint(
      selectedPoint,
      imagePaneSize,
      previewZoomDegrees,
    );
    const centerLat = dragStart?.centerLat ?? selectedPoint.lat;
    const centerLon = dragStart?.centerLon ?? selectedPoint.lon;
    const originX = dragStart?.originX ?? 0;
    const originY = dragStart?.originY ?? 0;
    const latSpan = dragStart?.latSpan ?? fallbackPreviewBbox.maxLat - fallbackPreviewBbox.minLat;
    const lonSpan = dragStart?.lonSpan ?? fallbackPreviewBbox.maxLon - fallbackPreviewBbox.minLon;
    const nextLat = clamp(centerLat + ((nextPan.y - originY) / rect.height) * latSpan, -85, 85);
    const nextLon = normalizeLongitude(centerLon - ((nextPan.x - originX) / rect.width) * lonSpan);

    setCommittedRegionalPan(nextPan);
    setRegionalPan(nextPan);
    invalidatePendingImageRequest();
    dragInvalidatedRequestRef.current = false;
    dragActiveRef.current = false;
    setManagedUpdateReason("positioning");
    recenterPoint(nextLat, nextLon);
  }

  function startRegionalDrag(nextDragStart: RegionalDragStartInput) {
    if (!selectedPoint || !previewBbox) {
      return;
    }

    dragActiveRef.current = true;
    dragInvalidatedRequestRef.current = false;

    if (imageLoading || updateReasonRef.current !== null || zoomCommitTimerRef.current !== null) {
      invalidatePendingImageRequest();
      dragInvalidatedRequestRef.current = true;
    }

    setRegionalDragStart({
      ...nextDragStart,
      centerLat: selectedPoint.lat,
      centerLon: selectedPoint.lon,
      latSpan: previewBbox.maxLat - previewBbox.minLat,
      lonSpan: previewBbox.maxLon - previewBbox.minLon,
    });
  }

  function cancelRegionalDrag() {
    dragActiveRef.current = false;
    setRegionalDragStart(null);
    setRegionalPan(committedRegionalPan);

    if (dragInvalidatedRequestRef.current) {
      dragInvalidatedRequestRef.current = false;
      restartCurrentImageRequest();
    }
  }

  function previewRegionalZoom(nextDegrees: number) {
    invalidatePendingImageRequest();
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

  function zoomRegionalImage(event: WheelEvent<HTMLElement>) {
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
    startRegionalDrag,
    cancelRegionalDrag,
    setRegionalPan,
    pointFromRegionalEvent,
    commitRegionalPan,
    zoomRegionalImage,
  };
}
