import { LoaderCircle, MapPinned } from "lucide-react";
import {
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cityLabels } from "@/lib/cities";
import {
  bboxWidthKm,
  clamp,
  formatApproxDistance,
  formatCoordinates,
  normalizeLongitude,
} from "@/lib/geo";
import { buildGibsWmsUrl } from "@/providers/GibsProvider";
import { getImageryProvider } from "@/providers/registry";
import { useAppStore } from "@/store/useAppStore";
import type { BoundingBox } from "@/types/imagery";

const MAX_IMAGE_SIZE = 1800;
const DETAILED_BOUNDARY_LAYER_ID = "Reference_Features";
const DETAILED_VIEW_MIN_LON_SPAN = 5.59263;
// ~the modal's per-tick span ratio: (12 / 0.09)^(1/100) from its percent curve.
const ZOOM_STEP_FACTOR = 1.05;
const ZOOM_SHIFT_TICKS = 3;
const ZOOM_COMMIT_DELAY_MS = 260;
const ZOOM_CROSSFADE_HOLD_MS = 300;

type DragStart = {
  pointerId: number;
  x: number;
  y: number;
  originX: number;
  originY: number;
  centerLat: number;
  centerLon: number;
  bbox: BoundingBox;
} | null;

type ZoomViewState = {
  lat: number;
  lon: number;
  latSpan: number;
  lonSpan: number;
};

// Modal-style zoom owned by the detail pass. While this is non-null, the detail
// preview is the source of truth and the globe only follows visually behind it.
// floor* = the spans at entry; zooming back out to the floor hands the wheel
// back to the globe camera.
type ZoomState = {
  floorLatSpan: number;
  floorLonSpan: number;
  committed: ZoomViewState;
  preview: ZoomViewState;
};

function bboxFromViewport(lat: number, lon: number, latSpan: number, lonSpan: number): BoundingBox {
  const halfLat = latSpan / 2;
  const halfLon = lonSpan / 2;

  return {
    minLat: clamp(lat - halfLat, -85, 85),
    maxLat: clamp(lat + halfLat, -85, 85),
    minLon: clamp(lon - halfLon, -180, 180),
    maxLon: clamp(lon + halfLon, -180, 180),
  };
}

function zoomViewBbox(view: ZoomViewState) {
  return bboxFromViewport(view.lat, view.lon, view.latSpan, view.lonSpan);
}

// Same math as the modal's transformForBboxes: maps the loaded raster onto the
// current target view as a center-origin translate+scale.
function transformForBboxes(
  paneSize: { width: number; height: number },
  loadedBbox: BoundingBox,
  targetBbox: BoundingBox,
) {
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

function bboxCacheKey(bbox: BoundingBox) {
  return [
    bbox.minLat,
    bbox.minLon,
    bbox.maxLat,
    bbox.maxLon,
  ]
    .map((value) => value.toFixed(4))
    .join(",");
}

function bboxFromCacheKey(key: string): BoundingBox | null {
  const [minLat, minLon, maxLat, maxLon] = key.split(",").map(Number);

  if ([minLat, minLon, maxLat, maxLon].some((value) => Number.isNaN(value))) {
    return null;
  }

  return { minLat, minLon, maxLat, maxLon };
}

function preloadImage(url: string) {
  return new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = reject;
    image.src = url;
  });
}

export function MaxZoomImagery() {
  const globeView = useAppStore((state) => state.globeView);
  const date = useAppStore((state) => state.date);
  const layerId = useAppStore((state) => state.layerId);
  const imageryVisible = useAppStore((state) => state.imageryVisible);
  const boundaryLinesVisible = useAppStore((state) => state.boundaryLinesVisible);
  const overlayLayersVisible = useAppStore((state) => state.overlayLayersVisible);
  const overlayLayerIds = useAppStore((state) => state.overlayLayerIds);
  const modalOpen = useAppStore((state) => state.modalOpen);
  const focusGlobeAt = useAppStore((state) => state.focusGlobeAt);
  const requestGlobeZoom = useAppStore((state) => state.requestGlobeZoom);
  const syncGlobeDetailView = useAppStore((state) => state.syncGlobeDetailView);
  const selectPoint = useAppStore((state) => state.selectPoint);
  const paneRef = useRef<HTMLDivElement>(null);
  const imageCacheRef = useRef(new Map<string, string>());
  const objectUrlsRef = useRef(new Set<string>());
  const cacheScopeRef = useRef<string | null>(null);
  const visibleScopeRef = useRef<string | null>(null);
  const zoomCommitTimerRef = useRef<number | null>(null);
  const requestVersionRef = useRef(0);
  const zoomPreviewRef = useRef<ZoomViewState | null>(null);
  const zoomActiveRef = useRef(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [displayedBbox, setDisplayedBbox] = useState<BoundingBox | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [committedPan, setCommittedPan] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<DragStart>(null);
  const [zoomState, setZoomState] = useState<ZoomState | null>(null);
  const [requestNonce, setRequestNonce] = useState(0);
  const [fadeOutLayer, setFadeOutLayer] = useState<{ url: string; transform: string } | null>(
    null,
  );
  const [viewportSize, setViewportSize] = useState({
    width: typeof window === "undefined" ? 1600 : window.innerWidth,
    height: typeof window === "undefined" ? 1000 : window.innerHeight,
  });

  const provider = getImageryProvider(layerId);
  const loadingMessage = provider.loadingMessage ?? "Loading detailed pass";
  const updatingMessage = provider.loadingMessage
    ? `Updating. ${provider.loadingMessage}`
    : "Updating";
  const zoomActive = zoomState !== null;
  // While the in-pass zoom owns the view, keep the pass mounted regardless of
  // the raycast-reported atMaxZoom flag. The synced background camera follows
  // the preview, but the reported globe view is not allowed to drive the pass.
  const isVisible = Boolean(imageryVisible && (zoomActive || globeView?.atMaxZoom));
  const aspect = viewportSize.width / Math.max(viewportSize.height, 1);
  // Request size always preserves the viewport aspect so the raster maps onto
  // the pane 1:1 (the zoom transform math assumes raster == full bbox == pane).
  const imageSize = (() => {
    let width = clamp(Math.round(viewportSize.width * 1.25), 1024, MAX_IMAGE_SIZE);
    let height = Math.max(1, Math.round(width / aspect));

    if (height > MAX_IMAGE_SIZE) {
      width = Math.max(1, Math.round((width * MAX_IMAGE_SIZE) / height));
      height = MAX_IMAGE_SIZE;
    }

    return { width, height };
  })();
  const imageWidth = imageSize.width;
  const imageHeight = imageSize.height;
  const bbox = useMemo(() => {
    if (!globeView) {
      return null;
    }

    return bboxFromViewport(globeView.lat, globeView.lon, globeView.latSpan, globeView.lonSpan);
  }, [globeView]);
  const zoomPreviewBbox = zoomState ? zoomViewBbox(zoomState.preview) : null;
  const zoomCommittedBbox = zoomState ? zoomViewBbox(zoomState.committed) : null;
  const activeBbox = zoomCommittedBbox ?? dragStart?.bbox ?? bbox;
  const activeBboxKey = activeBbox ? bboxCacheKey(activeBbox) : "";
  const requestBbox = useMemo(() => bboxFromCacheKey(activeBboxKey), [activeBboxKey]);
  const labelBbox = displayedBbox ?? activeBbox;
  const zoomTransform =
    zoomActive && displayedBbox && zoomPreviewBbox
      ? transformForBboxes(viewportSize, displayedBbox, zoomPreviewBbox)
      : null;
  const imageScaleX = zoomTransform?.scaleX ?? 1;
  const imageScaleY = zoomTransform?.scaleY ?? 1;
  const imageTransform = `translate(${pan.x}px, ${pan.y}px) scale(${imageScaleX}, ${imageScaleY})`;
  const boundaryImageUrl = labelBbox
    ? buildGibsWmsUrl(
        DETAILED_BOUNDARY_LAYER_ID,
        {
          bbox: labelBbox,
          date,
          width: imageWidth,
          height: imageHeight,
        },
        { transparent: true },
      )
    : null;
  const overlayImageUrls = useMemo(() => {
    if (!labelBbox || !overlayLayersVisible) {
      return [];
    }

    return overlayLayerIds
      .map((id) => {
        const overlay = getImageryProvider(id);

        if (!overlay.layerId) {
          return null;
        }

        return {
          id,
          url: buildGibsWmsUrl(
            overlay.layerId,
            {
              bbox: labelBbox,
              date: overlay.fixedDate ?? date,
              width: imageWidth,
              height: imageHeight,
            },
            { transparent: true },
          ),
        };
      })
      .filter((overlay): overlay is { id: string; url: string } => overlay !== null);
  }, [date, imageHeight, imageWidth, labelBbox, overlayLayerIds, overlayLayersVisible]);
  const cacheScope = activeBbox
    ? `${date}|${imageWidth}x${imageHeight}|${activeBboxKey}`
    : "";
  const visibleCityLabels = useMemo(() => {
    if (!labelBbox) {
      return [];
    }

    return cityLabels.filter(
      (city) =>
        city.lat >= labelBbox.minLat &&
        city.lat <= labelBbox.maxLat &&
        city.lon >= labelBbox.minLon &&
        city.lon <= labelBbox.maxLon,
    );
  }, [labelBbox]);

  const createImageUrl = useCallback((result: string | Blob) => {
    if (typeof result === "string") {
      return result;
    }

    const url = URL.createObjectURL(result);
    objectUrlsRef.current.add(url);
    return url;
  }, []);

  const revokeImageUrl = useCallback((url?: string | null) => {
    if (!url?.startsWith("blob:")) {
      return;
    }

    if (objectUrlsRef.current.delete(url)) {
      URL.revokeObjectURL(url);
    }
  }, []);

  // Drops the cache without revoking URLs that are still on screen (the
  // displayed image or a crossfade layer); those get swept on unmount.
  const clearImageCache = useCallback((keepUrls?: Set<string>) => {
    for (const cachedUrl of imageCacheRef.current.values()) {
      if (!keepUrls?.has(cachedUrl)) {
        revokeImageUrl(cachedUrl);
      }
    }

    imageCacheRef.current.clear();
  }, [revokeImageUrl]);

  function clearZoomCommitTimer() {
    if (zoomCommitTimerRef.current !== null) {
      window.clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
  }

  function commitPendingZoomPreview() {
    setZoomState((state) =>
      state && state.committed !== state.preview
        ? { ...state, committed: state.preview }
        : state,
    );
  }

  const syncDetailBackdrop = useCallback((view: ZoomViewState | null) => {
    syncGlobeDetailView(view);
  }, [syncGlobeDetailView]);

  useEffect(() => {
    let animationFrame = 0;

    function handleResize() {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        setViewportSize({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      });
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Crossfade for zoom-mode image swaps: hold the outgoing raster (frozen at
  // the transform it was showing) behind the incoming one, like the modal's
  // Sentinel handoff. Base-mode swaps keep today's clear-then-show behavior.
  const previousImageUrlRef = useRef(imageUrl);
  const liveImageTransformRef = useRef(imageTransform);

  useEffect(() => {
    const nextUrl = imageUrl;

    if (nextUrl === previousImageUrlRef.current) {
      return;
    }

    const previousUrl = previousImageUrlRef.current;
    previousImageUrlRef.current = nextUrl;

    if (!zoomActiveRef.current || !previousUrl || !nextUrl) {
      setFadeOutLayer(null);
      return;
    }

    const layer = { url: previousUrl, transform: liveImageTransformRef.current };
    setFadeOutLayer(layer);

    const timer = window.setTimeout(() => {
      setFadeOutLayer((current) => (current === layer ? null : current));
    }, ZOOM_CROSSFADE_HOLD_MS);

    return () => window.clearTimeout(timer);
  }, [imageUrl]);

  // Runs after the crossfade snapshot above so the snapshot reads the
  // transform from the previous render (what the outgoing image was showing).
  useEffect(() => {
    liveImageTransformRef.current = imageTransform;
    zoomActiveRef.current = zoomActive;
    zoomPreviewRef.current = zoomState?.preview ?? null;
  });

  useEffect(() => {
    if (!zoomState) {
      syncDetailBackdrop(null);
      return;
    }

    syncDetailBackdrop(zoomState.preview);
  }, [syncDetailBackdrop, zoomState]);

  useEffect(() => {
    if (!requestBbox || !isVisible) {
      return;
    }

    let cancelled = false;
    const requestVersion = requestVersionRef.current;
    const paneSize = viewportSize;
    const nextCacheScope = cacheScope;
    const cacheKey = `${nextCacheScope}|${provider.id}`;
    const nextVisibleScope = cacheKey;

    function applyLoadedImage(nextImageUrl: string) {
      setImageUrl(nextImageUrl);
      setDisplayedBbox(requestBbox);

      const preview = zoomPreviewRef.current;

      if (zoomActiveRef.current && preview && requestBbox) {
        const transform = transformForBboxes(paneSize, requestBbox, zoomViewBbox(preview));
        setPan(transform.pan);
        setCommittedPan(transform.pan);
      } else {
        setPan({ x: 0, y: 0 });
        setCommittedPan({ x: 0, y: 0 });
      }

      setLoading(false);
    }

    if (cacheScopeRef.current !== nextCacheScope) {
      const keepUrls = new Set<string>();

      if (imageUrl) {
        keepUrls.add(imageUrl);
      }

      if (fadeOutLayer) {
        keepUrls.add(fadeOutLayer.url);
      }

      clearImageCache(keepUrls);
      cacheScopeRef.current = nextCacheScope;
    }

    if (visibleScopeRef.current !== nextVisibleScope) {
      // In zoom mode the old raster stays up (re-projected by the transform)
      // until the new one crossfades in; clearing here would flash the globe.
      if (!zoomActiveRef.current) {
        setImageUrl(null);
        setDisplayedBbox(null);
        setPan({ x: 0, y: 0 });
        setCommittedPan({ x: 0, y: 0 });
      }

      visibleScopeRef.current = nextVisibleScope;
    }

    setLoading(true);
    setError(null);

    if (!zoomActiveRef.current) {
      setDragStart(null);
    }

    const cachedImageUrl = imageCacheRef.current.get(cacheKey);

    if (cachedImageUrl) {
      applyLoadedImage(cachedImageUrl);
      return () => {
        cancelled = true;
      };
    }

    provider
      .fetchImage({ bbox: requestBbox, date, width: imageWidth, height: imageHeight })
      .then(async (result) => {
        if (cancelled || requestVersion !== requestVersionRef.current) {
          return;
        }

        const nextImageUrl = createImageUrl(result);

        try {
          await preloadImage(nextImageUrl);
        } catch (error) {
          revokeImageUrl(nextImageUrl);
          throw error;
        }

        if (cancelled || requestVersion !== requestVersionRef.current) {
          revokeImageUrl(nextImageUrl);
          return;
        }

        imageCacheRef.current.set(cacheKey, nextImageUrl);
        applyLoadedImage(nextImageUrl);
      })
      .catch(() => {
        if (!cancelled && requestVersion === requestVersionRef.current) {
          setError("Detailed imagery is unavailable for this view.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // imageUrl/fadeOutLayer are only read to protect on-screen blob URLs from
    // cache eviction; re-running on their changes would refetch needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeBboxKey,
    cacheScope,
    clearImageCache,
    createImageUrl,
    date,
    imageHeight,
    imageWidth,
    isVisible,
    provider,
    requestBbox,
    requestNonce,
    revokeImageUrl,
    viewportSize,
  ]);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    const cache = imageCacheRef.current;

    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }

      urls.clear();
      cache.clear();
    };
  }, []);

  // Leaving the pass (zoom-out past the entry level, imagery toggled off)
  // resets the in-pass zoom so re-entry always starts at the globe's framing.
  useEffect(() => {
    if (isVisible) {
      return;
    }

    clearZoomCommitTimer();
    setZoomState(null);
    syncDetailBackdrop(null);
    setFadeOutLayer(null);
    setPan({ x: 0, y: 0 });
    setCommittedPan({ x: 0, y: 0 });
    setDragStart(null);
  }, [isVisible, syncDetailBackdrop]);

  useEffect(() => () => clearZoomCommitTimer(), []);

  useEffect(() => {
    document.body.classList.toggle("map-dragging-modal", Boolean(dragStart));

    return () => {
      document.body.classList.remove("map-dragging-modal");
    };
  }, [dragStart]);

  function getCenterForPan(
    nextPan: { x: number; y: number },
    sourceBbox: BoundingBox,
    centerLat: number,
    centerLon: number,
  ) {
    const rect = paneRef.current?.getBoundingClientRect();

    if (!rect) {
      return null;
    }

    const lonSpan = sourceBbox.maxLon - sourceBbox.minLon;
    const latSpan = sourceBbox.maxLat - sourceBbox.minLat;

    return {
      lat: clamp(centerLat + (nextPan.y / rect.height) * latSpan, -85, 85),
      lon: normalizeLongitude(centerLon - (nextPan.x / rect.width) * lonSpan),
    };
  }

  function commitPan(nextPan = pan) {
    if (zoomState) {
      commitZoomPan(nextPan);
      return;
    }

    if (!activeBbox || !globeView || (Math.abs(nextPan.x) < 4 && Math.abs(nextPan.y) < 4)) {
      setPan({ x: 0, y: 0 });
      return;
    }

    const center = getCenterForPan(
      nextPan,
      dragStart?.bbox ?? activeBbox,
      dragStart?.centerLat ?? globeView.lat,
      dragStart?.centerLon ?? globeView.lon,
    );

    setCommittedPan(nextPan);
    setPan(nextPan);

    if (center) {
      focusGlobeAt(center.lat, center.lon);
    }
  }

  function commitZoomPan(nextPan: { x: number; y: number }) {
    if (!zoomState) {
      return;
    }

    const start = dragStart;
    const dragDelta = start
      ? { x: nextPan.x - start.originX, y: nextPan.y - start.originY }
      : { x: 0, y: 0 };

    if (!start || (Math.abs(dragDelta.x) < 4 && Math.abs(dragDelta.y) < 4)) {
      // Tiny drag: restore the committed transform and make sure any zoom that
      // was pending (or in flight) when the pointer went down still lands.
      setPan(committedPan);
      commitPendingZoomPreview();
      setRequestNonce((nonce) => nonce + 1);
      return;
    }

    const center = getCenterForPan(dragDelta, start.bbox, start.centerLat, start.centerLon);

    if (!center) {
      setPan(committedPan);
      return;
    }

    const nextView: ZoomViewState = {
      lat: center.lat,
      lon: center.lon,
      latSpan: zoomState.preview.latSpan,
      lonSpan: zoomState.preview.lonSpan,
    };
    const transform = displayedBbox
      ? transformForBboxes(viewportSize, displayedBbox, zoomViewBbox(nextView))
      : null;
    const settledPan = transform?.pan ?? nextPan;

    setZoomState((state) =>
      state ? { ...state, committed: nextView, preview: nextView } : state,
    );
    syncDetailBackdrop(nextView);
    setPan(settledPan);
    setCommittedPan(settledPan);
  }

  function exitZoomToGlobe(event: WheelEvent<HTMLDivElement>) {
    clearZoomCommitTimer();
    requestVersionRef.current += 1;
    setZoomState(null);
    syncDetailBackdrop(null);
    setFadeOutLayer(null);
    setPan({ x: 0, y: 0 });
    setCommittedPan({ x: 0, y: 0 });
    // Clear the raster like today's base-mode zoom-out does: the globe behind
    // is lined up at the entry framing, so it takes over seamlessly while the
    // camera dollies out (and a new fetch lands if the user stops here).
    setImageUrl(null);
    setDisplayedBbox(null);
    setLoading(false);
    requestGlobeZoom(event.deltaY, event.shiftKey);
  }

  function applyZoomTick(event: WheelEvent<HTMLDivElement>) {
    const rect = paneRef.current?.getBoundingClientRect();

    if (!rect || !globeView) {
      return;
    }

    const floorLatSpan = zoomState?.floorLatSpan ?? globeView.latSpan;
    const floorLonSpan = zoomState?.floorLonSpan ?? globeView.lonSpan;
    const current = zoomState?.preview ?? {
      lat: globeView.lat,
      lon: globeView.lon,
      latSpan: floorLatSpan,
      lonSpan: floorLonSpan,
    };
    const zoomingIn = event.deltaY < 0;

    if (!zoomingIn && current.lonSpan >= floorLonSpan * 0.999) {
      exitZoomToGlobe(event);
      return;
    }

    const factor = Math.pow(ZOOM_STEP_FACTOR, event.shiftKey ? ZOOM_SHIFT_TICKS : 1);
    const nextLonSpan = clamp(
      zoomingIn ? current.lonSpan / factor : current.lonSpan * factor,
      DETAILED_VIEW_MIN_LON_SPAN,
      floorLonSpan,
    );

    if (nextLonSpan === current.lonSpan) {
      return;
    }

    const nextLatSpan = nextLonSpan * (floorLatSpan / floorLonSpan);

    // Cursor-anchored zoom, same math as the modal: the ground point under the
    // cursor stays under the cursor.
    const anchor = {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
    const anchorLat = clamp(current.lat - (anchor.y / rect.height) * current.latSpan, -85, 85);
    const anchorLon = normalizeLongitude(
      current.lon + (anchor.x / rect.width) * current.lonSpan,
    );
    const nextPreview: ZoomViewState = {
      lat: clamp(anchorLat + (anchor.y / rect.height) * nextLatSpan, -85, 85),
      lon: normalizeLongitude(anchorLon - (anchor.x / rect.width) * nextLonSpan),
      latSpan: nextLatSpan,
      lonSpan: nextLonSpan,
    };

    if (displayedBbox) {
      const transform = transformForBboxes(viewportSize, displayedBbox, zoomViewBbox(nextPreview));
      setPan(transform.pan);
      setCommittedPan(transform.pan);
    }

    setZoomState((state) => ({
      floorLatSpan,
      floorLonSpan,
      committed: state?.committed ?? current,
      preview: nextPreview,
    }));
    syncDetailBackdrop(nextPreview);
    setLoading(true);

    clearZoomCommitTimer();
    zoomCommitTimerRef.current = window.setTimeout(() => {
      zoomCommitTimerRef.current = null;
      commitPendingZoomPreview();
    }, ZOOM_COMMIT_DELAY_MS);
  }

  function pointFromImageClient(clientX: number, clientY: number) {
    const rect = paneRef.current?.getBoundingClientRect();

    if (!rect) {
      return null;
    }

    if (zoomState && zoomPreviewBbox) {
      const dragDelta = dragStart
        ? { x: pan.x - dragStart.originX, y: pan.y - dragStart.originY }
        : { x: 0, y: 0 };
      const baseX = clientX - rect.left - rect.width / 2 - dragDelta.x;
      const baseY = clientY - rect.top - rect.height / 2 - dragDelta.y;
      const lonSpan = zoomPreviewBbox.maxLon - zoomPreviewBbox.minLon;
      const latSpan = zoomPreviewBbox.maxLat - zoomPreviewBbox.minLat;

      return {
        lat: clamp(zoomState.preview.lat - (baseY / rect.height) * latSpan, -85, 85),
        lon: normalizeLongitude(zoomState.preview.lon + (baseX / rect.width) * lonSpan),
        imageryView: {
          latSpan,
          lonSpan,
          pixelWidth: rect.width,
          pixelHeight: rect.height,
        },
      };
    }

    const sourceBbox = displayedBbox ?? activeBbox;

    if (!sourceBbox) {
      return null;
    }

    const x = clamp(clientX - rect.left - pan.x, 0, rect.width);
    const y = clamp(clientY - rect.top - pan.y, 0, rect.height);
    const lonSpan = sourceBbox.maxLon - sourceBbox.minLon;
    const latSpan = sourceBbox.maxLat - sourceBbox.minLat;

    return {
      lat: clamp(sourceBbox.maxLat - (y / rect.height) * latSpan, -85, 85),
      lon: normalizeLongitude(sourceBbox.minLon + (x / rect.width) * lonSpan),
      imageryView: {
        latSpan,
        lonSpan,
        pixelWidth: rect.width,
        pixelHeight: rect.height,
      },
    };
  }

  function pointFromImageEvent(event: PointerEvent<HTMLImageElement> | MouseEvent<HTMLImageElement>) {
    return pointFromImageClient(event.clientX, event.clientY);
  }

  if (!isVisible || !activeBbox || !globeView) {
    return null;
  }

  const infoBbox = zoomPreviewBbox ?? activeBbox;
  const infoCenter = zoomState
    ? { lat: zoomState.preview.lat, lon: zoomState.preview.lon }
    : { lat: globeView.lat, lon: globeView.lon };
  const wideKm = bboxWidthKm(infoBbox);

  return (
    <div
      ref={paneRef}
      className="absolute inset-0 z-[5] overflow-hidden bg-transparent"
      onWheel={(event) => {
        event.preventDefault();

        if (event.deltaY === 0 || dragStart) {
          return;
        }

        if (zoomState) {
          applyZoomTick(event);
          return;
        }

        // First in-pass zoom-in enters the modal-style zoom (needs a loaded
        // raster to transform); everything else stays on the globe camera.
        if (event.deltaY < 0 && imageUrl && displayedBbox) {
          applyZoomTick(event);
          return;
        }

        requestGlobeZoom(event.deltaY, event.shiftKey);
      }}
    >
      {fadeOutLayer && (
        <img
          key={`fade-${fadeOutLayer.url}`}
          src={fadeOutLayer.url}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
          style={{
            transform: fadeOutLayer.transform,
            transformOrigin: "center",
            opacity: 1,
          }}
        />
      )}

      {imageUrl && (
        <img
          key={imageUrl}
          src={imageUrl}
          alt=""
          draggable={false}
          className={`h-full w-full cursor-grab select-none object-cover active:cursor-grabbing${
            fadeOutLayer ? " animate-in fade-in-0 duration-200" : ""
          }`}
          style={{
            transform: imageTransform,
            transformOrigin: "center",
            opacity: zoomActive ? 1 : dragStart ? 0.76 : 0.94,
            transition: dragStart || loading ? "none" : "transform 160ms ease-out",
          }}
          onContextMenu={(event) => {
            event.preventDefault();

            const point = pointFromImageEvent(event);

            if (point) {
              selectPoint(point.lat, point.lon, point.imageryView);
            }
          }}
          onPointerDown={(event) => {
            if (!bbox) {
              return;
            }

            window.getSelection()?.removeAllRanges();
            event.preventDefault();

            if (event.shiftKey) {
              const point = pointFromImageEvent(event);

              if (point) {
                selectPoint(point.lat, point.lon, point.imageryView);
              }

              return;
            }

            if (zoomState && zoomPreviewBbox) {
              // A drag supersedes any pending zoom commit; the drag commit
              // carries the preview spans, and in-flight loads are discarded
              // so they can't reposition the image mid-drag.
              clearZoomCommitTimer();
              requestVersionRef.current += 1;
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragStart({
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                originX: committedPan.x,
                originY: committedPan.y,
                centerLat: zoomState.preview.lat,
                centerLon: zoomState.preview.lon,
                bbox: zoomPreviewBbox,
              });
              return;
            }

            event.currentTarget.setPointerCapture(event.pointerId);
            setDragStart({
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              originX: committedPan.x,
              originY: committedPan.y,
              centerLat: globeView.lat,
              centerLon: globeView.lon,
              bbox,
            });
          }}
          onPointerMove={(event) => {
            if (!dragStart || dragStart.pointerId !== event.pointerId) {
              return;
            }

            const nextPan = {
              x: dragStart.originX + event.clientX - dragStart.x,
              y: dragStart.originY + event.clientY - dragStart.y,
            };
            const dragDelta = {
              x: nextPan.x - dragStart.originX,
              y: nextPan.y - dragStart.originY,
            };
            const center = getCenterForPan(
              zoomState ? dragDelta : nextPan,
              dragStart.bbox,
              dragStart.centerLat,
              dragStart.centerLon,
            );

            setPan(nextPan);

            if (center) {
              if (zoomState) {
                syncDetailBackdrop({
                  lat: center.lat,
                  lon: center.lon,
                  latSpan: zoomState.preview.latSpan,
                  lonSpan: zoomState.preview.lonSpan,
                });
              } else {
                focusGlobeAt(center.lat, center.lon, { immediate: true, syncView: false });
              }
            }
          }}
          onPointerUp={(event) => {
            const nextPan = dragStart
              ? {
                  x: dragStart.originX + event.clientX - dragStart.x,
                  y: dragStart.originY + event.clientY - dragStart.y,
                }
              : pan;

            setDragStart(null);
            commitPan(nextPan);
          }}
          onPointerCancel={() => {
            setDragStart(null);

            if (zoomState) {
              setPan(committedPan);
              commitPendingZoomPreview();
              setRequestNonce((nonce) => nonce + 1);
              return;
            }

            setPan(committedPan);
          }}
          onLoad={() => setLoading(false)}
          onError={() => {
            setError("Detailed imagery is unavailable for this view.");
            setLoading(false);
          }}
        />
      )}

      {imageUrl &&
        overlayImageUrls.map((overlay) => (
          <img
            key={overlay.id}
            src={overlay.url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 z-[4] h-full w-full select-none object-cover"
            style={{
              opacity: 0.9,
              transform: imageTransform,
              transformOrigin: "center",
            }}
          />
        ))}

      {imageUrl && boundaryLinesVisible && boundaryImageUrl && (
        <img
          key={boundaryImageUrl}
          src={boundaryImageUrl}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 z-[5] h-full w-full select-none object-cover animate-in fade-in-0 duration-500"
          style={{
            transform: imageTransform,
            transformOrigin: "center",
            filter:
              "brightness(0) invert(1) drop-shadow(0 0 1px rgba(0, 0, 0, 0.95))",
            // Only the fade animation should run; keep the pan transform instant
            // (the duration class would otherwise transition it and lag drags).
            transition: "none",
          }}
        />
      )}

      {imageUrl && !modalOpen && labelBbox && visibleCityLabels.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-[6]">
          {visibleCityLabels.map((city) => {
            const lonSpan = labelBbox.maxLon - labelBbox.minLon;
            const latSpan = labelBbox.maxLat - labelBbox.minLat;
            const left = ((city.lon - labelBbox.minLon) / lonSpan) * 100;
            const top = ((labelBbox.maxLat - city.lat) / latSpan) * 100;

            return (
              <span
                key={city.name}
                className="city-label absolute"
                style={{
                  left: `calc(50% + ${(left - 50) * imageScaleX}% + ${pan.x}px)`,
                  top: `calc(50% + ${(top - 50) * imageScaleY}% + ${pan.y}px)`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                {city.name}
              </span>
            );
          })}
        </div>
      )}

      <div className="pointer-events-none absolute left-4 top-28 z-10 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-md border border-white/10 bg-background/55 px-3 py-2 text-sm text-white/85 shadow-2xl backdrop-blur md:left-6">
        <MapPinned className="h-4 w-4 text-primary" />
        <span className="font-medium">{provider.name}</span>
        <span className="text-muted-foreground">{formatCoordinates(infoCenter.lat, infoCenter.lon)}</span>
        <span className="text-muted-foreground">{formatApproxDistance(wideKm / 111)} wide</span>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-32 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-primary/35 bg-background/70 px-3 py-2 text-sm text-white/90 shadow-2xl backdrop-blur">
        <kbd className="rounded-sm border border-white/15 bg-white/10 px-1.5 py-0.5 font-mono text-xs text-primary">
          Shift
        </kbd>
        <span>click for higher resolution</span>
      </div>

      {!imageUrl && loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/20">
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-background/75 px-3 py-2 text-sm shadow-xl backdrop-blur">
            <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
            {loadingMessage}
          </div>
        </div>
      )}

      {imageUrl && loading && !error && (
        <div className="pointer-events-none absolute bottom-6 left-4 flex items-center gap-2 rounded-md border border-white/10 bg-background/65 px-2 py-1 text-xs text-white/85 shadow-xl backdrop-blur md:left-6">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
          {updatingMessage}
        </div>
      )}

      {error && (
        <div className="pointer-events-none absolute inset-x-4 bottom-8 mx-auto max-w-md rounded-md border border-destructive/30 bg-background/80 px-3 py-2 text-center text-sm text-destructive shadow-xl backdrop-blur">
          {error}
        </div>
      )}
    </div>
  );
}
