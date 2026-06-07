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
  clamp,
  degreesToZoomPercent,
  normalizeLongitude,
  zoomPercentToDegrees,
} from "@/lib/geo";
import { getSentinelVariant } from "@/lib/sentinelVariants";
import type { BoundingBox, ImageryProvider, SentinelSceneGeometry } from "@/types/imagery";
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
  bbox: BoundingBox;
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
const MAX_REGIONAL_IMAGE_CACHE_ENTRIES = 12;
const DEFAULT_PANE_SIZE = { width: 1024, height: 1024 };
const GIBS_REGIONAL_IMAGE_MAX_SIZE = 1400;
const SENTINEL_REGIONAL_IMAGE_MAX_SIZE = 1024;
const REGIONAL_IMAGE_MIN_LONG_EDGE = 768;

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
  setRegionalView: (lat: number, lon: number, imageryZoomDegrees: number) => void;
  recenterPoint: (lat: number, lon: number) => void;
};

type RegionalView = {
  lat: number;
  lon: number;
  zoomDegrees: number;
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

function scalePanForZoom(
  pan: { x: number; y: number },
  previousZoomDegrees: number,
  nextZoomDegrees: number,
) {
  if (nextZoomDegrees <= 0 || previousZoomDegrees === nextZoomDegrees) {
    return pan;
  }

  const scale = previousZoomDegrees / nextZoomDegrees;

  return {
    x: pan.x * scale,
    y: pan.y * scale,
  };
}

function imageRequestSizeForPane(
  imagePaneSize: { width: number; height: number } | null,
  maxSize: number,
) {
  const paneSize = imagePaneSize ?? DEFAULT_PANE_SIZE;
  const paneWidth = Math.max(1, paneSize.width);
  const paneHeight = Math.max(1, paneSize.height);
  const scale = Math.min(
    maxSize / Math.max(paneWidth, paneHeight),
    Math.max(REGIONAL_IMAGE_MIN_LONG_EDGE, Math.max(paneWidth, paneHeight)) /
      Math.max(paneWidth, paneHeight),
  );

  return {
    width: Math.max(256, Math.round(paneWidth * scale)),
    height: Math.max(256, Math.round(paneHeight * scale)),
  };
}

function bboxForPoint(
  selectedPoint: SelectedPoint,
  imagePaneSize: { width: number; height: number } | null,
  zoomDegrees: number,
) {
  // The bbox aspect ratio must always match the image pane's aspect ratio.
  // The rendered <img> fills the pane (object-fill), and the blurry->sharp
  // handoff transform (transformForBboxes) assumes the raster represents the
  // full bbox stretched across the pane. If the bbox shape diverges from the
  // pane shape, object-fill squashes the image (stretch/tilt) and the preview
  // transform lands on different ground than the freshly loaded image (jump).
  //
  // imageryView only seeds the opening zoom level (via selectPoint setting
  // imageryZoomDegrees); it must not influence the bbox shape here.
  const paneSize = imagePaneSize ?? DEFAULT_PANE_SIZE;
  const paneAspect = Math.max(1, paneSize.width) / Math.max(1, paneSize.height);

  return bboxFromSpans(
    selectedPoint.lat,
    selectedPoint.lon,
    paneAspect >= 1 ? zoomDegrees / paneAspect : zoomDegrees,
    paneAspect >= 1 ? zoomDegrees : zoomDegrees * paneAspect,
  );
}

function transformForBboxes({
  imagePaneSize,
  loadedBbox,
  targetBbox,
}: {
  imagePaneSize: { width: number; height: number } | null;
  loadedBbox: BoundingBox;
  targetBbox: BoundingBox;
}) {
  const paneSize = imagePaneSize ?? DEFAULT_PANE_SIZE;
  const loadedLatSpan = loadedBbox.maxLat - loadedBbox.minLat;
  const loadedLonSpan = loadedBbox.maxLon - loadedBbox.minLon;
  const targetLatSpan = targetBbox.maxLat - targetBbox.minLat;
  const targetLonSpan = targetBbox.maxLon - targetBbox.minLon;

  if (
    loadedLatSpan <= 0 ||
    loadedLonSpan <= 0 ||
    targetLatSpan <= 0 ||
    targetLonSpan <= 0
  ) {
    return { pan: { x: 0, y: 0 }, scaleX: 1, scaleY: 1 };
  }

  const loadedLat = (loadedBbox.minLat + loadedBbox.maxLat) / 2;
  const loadedLon = normalizeLongitude((loadedBbox.minLon + loadedBbox.maxLon) / 2);
  const targetLat = (targetBbox.minLat + targetBbox.maxLat) / 2;
  const targetLon = normalizeLongitude((targetBbox.minLon + targetBbox.maxLon) / 2);

  return {
    pan: {
      x: (normalizeLongitude(loadedLon - targetLon) / targetLonSpan) * paneSize.width,
      y: ((targetLat - loadedLat) / targetLatSpan) * paneSize.height,
    },
    scaleX: loadedLonSpan / targetLonSpan,
    scaleY: loadedLatSpan / targetLatSpan,
  };
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
  setRegionalView,
  recenterPoint,
  createObjectUrl,
  revokeObjectUrl,
}: RegionalImageryOptions) {
  const imageScopeRef = useRef<string | null>(null);
  const imageCacheRef = useRef(new Map<string, CachedRegionalImage>());
  const wasModalOpenRef = useRef(false);
  const zoomCommitTimerRef = useRef<number | null>(null);
  const pendingZoomViewRef = useRef<RegionalView | null>(null);
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
  const [loadedImageBbox, setLoadedImageBbox] = useState<BoundingBox | null>(null);
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

    return bboxForPoint(
      { lat: selectedPoint.lat, lon: selectedPoint.lon },
      imagePaneSize,
      imageryZoomDegrees,
    );
  }, [imagePaneSize, imageryZoomDegrees, selectedPoint]);
  const regionalImageSize = imageRequestSizeForPane(
    imagePaneSize,
    provider.sentinelVariantId ? SENTINEL_REGIONAL_IMAGE_MAX_SIZE : GIBS_REGIONAL_IMAGE_MAX_SIZE,
  );
  const regionalImageWidth = regionalImageSize.width;
  const regionalImageHeight = regionalImageSize.height;
  const activePreviewView = pendingZoomViewRef.current ?? (
    selectedPoint
      ? {
          lat: selectedPoint.lat,
          lon: selectedPoint.lon,
          zoomDegrees: previewZoomDegrees,
        }
      : null
  );
  const activePreviewBbox =
    selectedPoint && activePreviewView
      ? bboxForPoint(
          { ...selectedPoint, lat: activePreviewView.lat, lon: activePreviewView.lon },
          imagePaneSize,
          activePreviewView.zoomDegrees,
        )
      : previewBbox;
  const imagePreviewTransform = loadedImageBbox && activePreviewBbox
    ? transformForBboxes({
        imagePaneSize,
        loadedBbox: loadedImageBbox,
        targetBbox: activePreviewBbox,
      })
    : {
        pan: regionalPan,
        scaleX: loadedImageZoomDegrees / previewZoomDegrees,
        scaleY: loadedImageZoomDegrees / previewZoomDegrees,
      };
  const imagePreviewScaleX = imagePreviewTransform.scaleX;
  const imagePreviewScaleY = imagePreviewTransform.scaleY;

  const setManagedImage = useCallback((image: CachedRegionalImage | null) => {
    imageUrlRef.current = image?.imageUrl ?? null;
    setImageUrl(image?.imageUrl ?? null);
    setAcquiredScenes(image?.scenes ?? []);
    setLoadedImageBbox(image?.bbox ?? null);
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

  const revokeCachedRegionalImage = useCallback(
    (image?: CachedRegionalImage | null) => {
      revokeObjectUrl(image?.imageUrl);
    },
    [revokeObjectUrl],
  );

  const cacheRegionalImage = useCallback(
    (key: string, image: CachedRegionalImage) => {
      const existingImage = imageCacheRef.current.get(key);

      if (existingImage && existingImage.imageUrl !== image.imageUrl) {
        revokeCachedRegionalImage(existingImage);
      }

      imageCacheRef.current.delete(key);
      imageCacheRef.current.set(key, image);

      while (imageCacheRef.current.size > MAX_REGIONAL_IMAGE_CACHE_ENTRIES) {
        const oldestKey = imageCacheRef.current.keys().next().value;

        if (!oldestKey) {
          break;
        }

        const oldestImage = imageCacheRef.current.get(oldestKey);
        imageCacheRef.current.delete(oldestKey);
        revokeCachedRegionalImage(oldestImage);
      }
    },
    [revokeCachedRegionalImage],
  );

  function clearPendingZoomCommit() {
    if (zoomCommitTimerRef.current === null) {
      return false;
    }

    window.clearTimeout(zoomCommitTimerRef.current);
    zoomCommitTimerRef.current = null;

    return true;
  }

  function commitPendingZoomView() {
    const pendingView = pendingZoomViewRef.current;

    if (!pendingView) {
      return;
    }

    pendingZoomViewRef.current = null;
    setRegionalView(pendingView.lat, pendingView.lon, pendingView.zoomDegrees);
  }

  useEffect(() => {
    if (!modalOpen || !bbox) {
      return;
    }

    if (dragActiveRef.current) {
      return;
    }

    let cancelled = false;
    let loadTimer: number | null = null;
    const abortController = new AbortController();
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
      imageCacheRef.current.delete(cacheKey);
      imageCacheRef.current.set(cacheKey, cachedImageUrl);
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
      signal: AbortSignal,
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
        signal,
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

    async function loadRegionalImage(requestBbox: NonNullable<typeof bbox>, signal: AbortSignal) {
      const [result, scenes] = await Promise.all([
        provider.fetchImage({
          bbox: requestBbox,
          date,
          signal,
          width: regionalImageWidth,
          height: regionalImageHeight,
        }),
        resolveContributingScenes(requestBbox, signal).catch(() => [] as SceneAcquisition[]),
      ]);
      const nextImageUrl = typeof result === "string" ? result : createObjectUrl(result);

      try {
        await preloadImage(nextImageUrl);
      } catch (error) {
        revokeObjectUrl(nextImageUrl);
        throw error;
      }

      return {
        imageUrl: nextImageUrl,
        scenes,
        bbox: requestBbox,
      };
    }

    function loadLatestRegionalImage() {
      if (cancelled || dragActiveRef.current || requestVersion !== requestVersionRef.current) {
        return;
      }

      loadRegionalImage(requestBbox, abortController.signal)
        .then(async (result) => {
          if (cancelled || dragActiveRef.current || requestVersion !== requestVersionRef.current) {
            revokeCachedRegionalImage(result);
            return;
          }

          setManagedImage(result);
          cacheRegionalImage(cacheKey, result);
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
            const fallbackImageUrl = await loadRegionalImage(
              fallbackBbox,
              abortController.signal,
            );

            if (!cancelled && !dragActiveRef.current && requestVersion === requestVersionRef.current) {
              setManagedImage(fallbackImageUrl);
              cacheRegionalImage(cacheKey, fallbackImageUrl);
              setLoadedImageZoomDegrees(requestZoomDegrees);
              setPreviewZoomDegrees(requestZoomDegrees);
              setRegionalPan({ x: 0, y: 0 });
              setCommittedRegionalPan({ x: 0, y: 0 });
              setImageLoading(false);
              setManagedUpdateReason(null);
            } else {
              revokeCachedRegionalImage(fallbackImageUrl);
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
      abortController.abort();
      if (loadTimer !== null) {
        window.clearTimeout(loadTimer);
      }
    };
  }, [
    bbox,
    cacheRegionalImage,
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
    revokeCachedRegionalImage,
    revokeObjectUrl,
  ]);

  useEffect(() => {
    if (!modalOpen) {
      invalidatePendingImageRequest();
      clearPendingZoomCommit();
      pendingZoomViewRef.current = null;
      imageScopeRef.current = null;
      dragInvalidatedRequestRef.current = false;
      dragActiveRef.current = false;
      setManagedImage(null);
      setImageLoading(false);
      setError(null);
      setRegionalPan({ x: 0, y: 0 });
      setCommittedRegionalPan({ x: 0, y: 0 });
      setRegionalDragStart(null);
      setManagedUpdateReason(null);
      return;
    }

    if (modalOpen && !wasModalOpenRef.current) {
      setPreviewZoomDegrees(imageryZoomDegrees);
      setLoadedImageZoomDegrees(imageryZoomDegrees);
    }

    wasModalOpenRef.current = modalOpen;
  }, [
    imageryZoomDegrees,
    invalidatePendingImageRequest,
    modalOpen,
    setManagedImage,
    setManagedUpdateReason,
  ]);

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current !== null) {
        window.clearTimeout(zoomCommitTimerRef.current);
      }
    };
  }, []);

  function pointFromRegionalEvent(event: PointerEvent<HTMLElement>) {
    const eventBbox = activePreviewBbox ?? previewBbox;

    if (!eventBbox || !selectedPoint) {
      return null;
    }

    const rect = imagePaneRef.current?.getBoundingClientRect();

    if (!rect) {
      return null;
    }

    const activeDragPan = regionalDragStart
      ? {
          x: regionalPan.x - regionalDragStart.originX,
          y: regionalPan.y - regionalDragStart.originY,
        }
      : { x: 0, y: 0 };
    const baseX = event.clientX - rect.left - rect.width / 2 - activeDragPan.x;
    const baseY = event.clientY - rect.top - rect.height / 2 - activeDragPan.y;
    const lonSpan = eventBbox.maxLon - eventBbox.minLon;
    const latSpan = eventBbox.maxLat - eventBbox.minLat;

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
    const hadPendingZoom = clearPendingZoomCommit();
    pendingZoomViewRef.current = null;

    if (hadPendingZoom) {
      setRegionalView(nextLat, nextLon, previewZoomDegrees);
      return;
    }

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
    if (nextDegrees === previewZoomDegrees) {
      return;
    }

    invalidatePendingImageRequest();
    setRegionalPan((currentPan) =>
      scalePanForZoom(currentPan, previewZoomDegrees, nextDegrees),
    );
    setCommittedRegionalPan((currentPan) =>
      scalePanForZoom(currentPan, previewZoomDegrees, nextDegrees),
    );
    setPreviewZoomDegrees(nextDegrees);
    setManagedUpdateReason("resolution");

    clearPendingZoomCommit();

    zoomCommitTimerRef.current = window.setTimeout(() => {
      zoomCommitTimerRef.current = null;

      if (nextDegrees === imageryZoomDegrees) {
        restartCurrentImageRequest();
        return;
      }

      setImageryZoomDegrees(nextDegrees);
    }, 260);
  }

  function previewRegionalZoomAtCursor(
    nextDegrees: number,
    event: WheelEvent<HTMLElement>,
  ) {
    if (
      !selectedPoint ||
      !previewBbox ||
      !loadedImageBbox ||
      nextDegrees === previewZoomDegrees
    ) {
      previewRegionalZoom(nextDegrees);
      return;
    }

    const rect = imagePaneRef.current?.getBoundingClientRect();

    if (!rect) {
      previewRegionalZoom(nextDegrees);
      return;
    }

    const currentView = pendingZoomViewRef.current ?? {
      lat: selectedPoint.lat,
      lon: selectedPoint.lon,
      zoomDegrees: previewZoomDegrees,
    };
    const activeDragPan = regionalDragStart
      ? {
          x: regionalPan.x - regionalDragStart.originX,
          y: regionalPan.y - regionalDragStart.originY,
        }
      : { x: 0, y: 0 };
    const anchor = {
      x: event.clientX - rect.left - rect.width / 2 - activeDragPan.x,
      y: event.clientY - rect.top - rect.height / 2 - activeDragPan.y,
    };
    const currentBbox = bboxForPoint(
      { ...selectedPoint, lat: currentView.lat, lon: currentView.lon },
      imagePaneSize,
      currentView.zoomDegrees,
    );
    const currentLatSpan = currentBbox.maxLat - currentBbox.minLat;
    const currentLonSpan = currentBbox.maxLon - currentBbox.minLon;
    const anchorLat = clamp(
      currentView.lat - (anchor.y / rect.height) * currentLatSpan,
      -85,
      85,
    );
    const anchorLon = normalizeLongitude(
      currentView.lon + (anchor.x / rect.width) * currentLonSpan,
    );
    const nextBbox = bboxForPoint(
      { ...selectedPoint, lat: currentView.lat, lon: currentView.lon },
      imagePaneSize,
      nextDegrees,
    );
    const nextLatSpan = nextBbox.maxLat - nextBbox.minLat;
    const nextLonSpan = nextBbox.maxLon - nextBbox.minLon;
    const nextCenter = {
      lat: clamp(anchorLat + (anchor.y / rect.height) * nextLatSpan, -85, 85),
      lon: normalizeLongitude(anchorLon - (anchor.x / rect.width) * nextLonSpan),
    };
    const nextTargetBbox = bboxForPoint(
      { ...selectedPoint, lat: nextCenter.lat, lon: nextCenter.lon },
      imagePaneSize,
      nextDegrees,
    );
    const nextTransform = transformForBboxes({
      imagePaneSize,
      loadedBbox: loadedImageBbox,
      targetBbox: nextTargetBbox,
    });

    invalidatePendingImageRequest();
    setRegionalPan(nextTransform.pan);
    setCommittedRegionalPan(nextTransform.pan);
    setPreviewZoomDegrees(nextDegrees);
    setImageLoading(true);
    setManagedUpdateReason("resolution");

    clearPendingZoomCommit();
    pendingZoomViewRef.current = {
      lat: nextCenter.lat,
      lon: nextCenter.lon,
      zoomDegrees: nextDegrees,
    };

    zoomCommitTimerRef.current = window.setTimeout(() => {
      zoomCommitTimerRef.current = null;
      commitPendingZoomView();
    }, 260);
  }

  function zoomRegionalImage(event: WheelEvent<HTMLElement>) {
    event.preventDefault();

    const currentPercent = degreesToZoomPercent(previewZoomDegrees);
    const nextPercent = clamp(currentPercent + (event.deltaY > 0 ? -1 : 1), 0, 100);

    const nextDegrees = zoomPercentToDegrees(nextPercent);

    if (provider.sentinelVariantId) {
      previewRegionalZoomAtCursor(nextDegrees, event);
      return;
    }

    previewRegionalZoom(nextDegrees);
  }

  return {
    bbox,
    acquiredScenes,
    imagePreviewScaleX,
    imagePreviewScaleY,
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
