import { LoaderCircle, MapPinned } from "lucide-react";
import { type MouseEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { bboxWidthKm, clamp, formatApproxDistance, formatCoordinates, normalizeLongitude } from "@/lib/geo";
import { getImageryProvider } from "@/providers/registry";
import { useAppStore } from "@/store/useAppStore";
import type { BoundingBox } from "@/types/imagery";

const MAX_IMAGE_SIZE = 1800;

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
  const focusGlobeAt = useAppStore((state) => state.focusGlobeAt);
  const selectPoint = useAppStore((state) => state.selectPoint);
  const paneRef = useRef<HTMLDivElement>(null);
  const imageCacheRef = useRef(new Map<string, string>());
  const cacheScopeRef = useRef<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [committedPan, setCommittedPan] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<DragStart>(null);
  const [isSuppressed, setIsSuppressed] = useState(false);
  const [viewportSize, setViewportSize] = useState({
    width: typeof window === "undefined" ? 1600 : window.innerWidth,
    height: typeof window === "undefined" ? 1000 : window.innerHeight,
  });

  const provider = getImageryProvider(layerId);
  const isVisible = Boolean(globeView?.atMaxZoom && !isSuppressed);
  const aspect = viewportSize.width / Math.max(viewportSize.height, 1);
  const bbox = useMemo(() => {
    if (!globeView) {
      return null;
    }

    return bboxFromViewport(globeView.lat, globeView.lon, globeView.latSpan, globeView.lonSpan);
  }, [globeView]);
  const activeBbox = dragStart?.bbox ?? bbox;
  const imageWidth = Math.min(MAX_IMAGE_SIZE, Math.max(1024, Math.round(viewportSize.width * 1.25)));
  const imageHeight = Math.min(MAX_IMAGE_SIZE, Math.max(768, Math.round(imageWidth / aspect)));
  const activeBboxKey = activeBbox ? bboxCacheKey(activeBbox) : "";
  const cacheScope = activeBbox
    ? `${date}|${imageWidth}x${imageHeight}|${activeBboxKey}`
    : "";

  useEffect(() => {
    function handleResize() {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!activeBbox || !isVisible) {
      return;
    }

    let cancelled = false;
    const nextCacheScope = cacheScope;
    const cacheKey = `${nextCacheScope}|${provider.id}`;

    if (cacheScopeRef.current !== nextCacheScope) {
      imageCacheRef.current.clear();
      cacheScopeRef.current = nextCacheScope;
    }

    setLoading(true);
    setError(null);
    setDragStart(null);

    const cachedImageUrl = imageCacheRef.current.get(cacheKey);

    if (cachedImageUrl) {
      setImageUrl(cachedImageUrl);
      setPan({ x: 0, y: 0 });
      setCommittedPan({ x: 0, y: 0 });
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    provider
      .fetchImage({ bbox: activeBbox, date, width: imageWidth, height: imageHeight })
      .then(async (result) => {
        if (cancelled) {
          return;
        }

        const nextImageUrl = typeof result === "string" ? result : URL.createObjectURL(result);
        await preloadImage(nextImageUrl);

        if (cancelled) {
          return;
        }

        imageCacheRef.current.set(cacheKey, nextImageUrl);
        setImageUrl(nextImageUrl);
        setPan({ x: 0, y: 0 });
        setCommittedPan({ x: 0, y: 0 });
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Detailed imagery is unavailable for this view.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeBbox, cacheScope, date, imageHeight, imageWidth, isVisible, provider]);

  useEffect(() => {
    if (globeView?.atMaxZoom) {
      setIsSuppressed(false);
    }
  }, [globeView?.atMaxZoom]);

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

  function pointFromImageClient(clientX: number, clientY: number) {
    const rect = paneRef.current?.getBoundingClientRect();

    if (!rect || !activeBbox) {
      return null;
    }

    const x = clamp(clientX - rect.left - pan.x, 0, rect.width);
    const y = clamp(clientY - rect.top - pan.y, 0, rect.height);
    const lonSpan = activeBbox.maxLon - activeBbox.minLon;
    const latSpan = activeBbox.maxLat - activeBbox.minLat;

    return {
      lat: clamp(activeBbox.maxLat - (y / rect.height) * latSpan, -85, 85),
      lon: normalizeLongitude(activeBbox.minLon + (x / rect.width) * lonSpan),
      zoomDegrees: lonSpan,
    };
  }

  function pointFromImageEvent(event: PointerEvent<HTMLImageElement> | MouseEvent<HTMLImageElement>) {
    return pointFromImageClient(event.clientX, event.clientY);
  }

  if (!isVisible || !activeBbox || !globeView) {
    return null;
  }

  const wideKm = bboxWidthKm(activeBbox);

  return (
    <div
      ref={paneRef}
      className="absolute inset-0 z-[5] overflow-hidden bg-transparent"
      onWheel={(event) => {
        if (event.deltaY > 0) {
          setIsSuppressed(true);
        }
      }}
    >
      {imageUrl && (
        <img
          key={imageUrl}
          src={imageUrl}
          alt=""
          draggable={false}
          className="h-full w-full cursor-grab select-none object-cover active:cursor-grabbing"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            opacity: dragStart ? 0.76 : 0.94,
            transition: dragStart || loading ? "none" : "transform 160ms ease-out",
          }}
          onContextMenu={(event) => {
            event.preventDefault();

            const point = pointFromImageEvent(event);

            if (point) {
              selectPoint(point.lat, point.lon, point.zoomDegrees);
            }
          }}
          onPointerDown={(event) => {
            if (!bbox) {
              return;
            }

            if (event.shiftKey) {
              const point = pointFromImageEvent(event);

              if (point) {
                selectPoint(point.lat, point.lon, point.zoomDegrees);
              }

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
            const center = getCenterForPan(
              nextPan,
              dragStart.bbox,
              dragStart.centerLat,
              dragStart.centerLon,
            );

            setPan(nextPan);

            if (center) {
              focusGlobeAt(center.lat, center.lon, { immediate: true, syncView: false });
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
            setPan(committedPan);
          }}
          onLoad={() => setLoading(false)}
          onError={() => {
            setError("Detailed imagery is unavailable for this view.");
            setLoading(false);
          }}
        />
      )}

      <div className="pointer-events-none absolute left-4 top-28 z-10 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-md border border-white/10 bg-background/55 px-3 py-2 text-sm text-white/85 shadow-2xl backdrop-blur md:left-6">
        <MapPinned className="h-4 w-4 text-primary" />
        <span className="font-medium">{provider.name}</span>
        <span className="text-muted-foreground">{formatCoordinates(globeView.lat, globeView.lon)}</span>
        <span className="text-muted-foreground">{formatApproxDistance(wideKm / 111)} wide</span>
      </div>

      {!imageUrl && loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/20">
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-background/75 px-3 py-2 text-sm shadow-xl backdrop-blur">
            <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
            Loading detailed pass
          </div>
        </div>
      )}

      {imageUrl && loading && !error && (
        <div className="pointer-events-none absolute bottom-6 left-4 flex items-center gap-2 rounded-md border border-white/10 bg-background/65 px-2 py-1 text-xs text-white/85 shadow-xl backdrop-blur md:left-6">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
          Updating
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
