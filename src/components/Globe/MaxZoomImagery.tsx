import { LoaderCircle, MapPinned } from "lucide-react";
import {
  type MouseEvent,
  type PointerEvent,
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
import { getImageryProvider } from "@/providers/registry";
import { useAppStore } from "@/store/useAppStore";
import type { BoundingBox } from "@/types/imagery";
import {
  ADMIN_1_GEOJSON_URLS,
  fetchGeoJson,
  type GeoJsonCollection,
  type Position,
  WORLD_GEOJSON_URLS,
} from "./BoundaryLines";

const MAX_IMAGE_SIZE = 1800;
const BOUNDARY_SVG_VIEWBOX_SIZE = 100;

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

function pointToSvgPoint([lon, lat]: Position, bbox: BoundingBox) {
  const lonSpan = bbox.maxLon - bbox.minLon;
  const latSpan = bbox.maxLat - bbox.minLat;

  if (lonSpan <= 0 || latSpan <= 0) {
    return null;
  }

  return {
    x: ((lon - bbox.minLon) / lonSpan) * BOUNDARY_SVG_VIEWBOX_SIZE,
    y: ((bbox.maxLat - lat) / latSpan) * BOUNDARY_SVG_VIEWBOX_SIZE,
  };
}

function positionsToSegmentPaths(positions: Position[], bbox: BoundingBox) {
  const paths: string[] = [];
  const lonMargin = (bbox.maxLon - bbox.minLon) * 0.05;
  const latMargin = (bbox.maxLat - bbox.minLat) * 0.05;

  for (let index = 0; index < positions.length - 1; index += 1) {
    const start = positions[index];
    const end = positions[index + 1];
    const minLon = Math.min(start[0], end[0]);
    const maxLon = Math.max(start[0], end[0]);
    const minLat = Math.min(start[1], end[1]);
    const maxLat = Math.max(start[1], end[1]);

    if (Math.abs(start[0] - end[0]) > 180) {
      continue;
    }

    if (
      maxLon < bbox.minLon - lonMargin ||
      minLon > bbox.maxLon + lonMargin ||
      maxLat < bbox.minLat - latMargin ||
      minLat > bbox.maxLat + latMargin
    ) {
      continue;
    }

    const a = pointToSvgPoint(start, bbox);
    const b = pointToSvgPoint(end, bbox);

    if (!a || !b) {
      continue;
    }

    paths.push(`M ${a.x.toFixed(3)} ${a.y.toFixed(3)} L ${b.x.toFixed(3)} ${b.y.toFixed(3)}`);
  }

  return paths;
}

function collectionToPaths(collection: GeoJsonCollection | null, bbox: BoundingBox) {
  if (!collection) {
    return [];
  }

  const paths: string[] = [];

  for (const feature of collection.features) {
    const geometry = feature.geometry;

    if (!geometry) {
      continue;
    }

    if (geometry.type === "LineString") {
      paths.push(...positionsToSegmentPaths(geometry.coordinates, bbox));
    }

    if (geometry.type === "MultiLineString") {
      for (const line of geometry.coordinates) {
        paths.push(...positionsToSegmentPaths(line, bbox));
      }
    }

    if (geometry.type === "Polygon") {
      for (const ring of geometry.coordinates) {
        paths.push(...positionsToSegmentPaths(ring, bbox));
      }
    }

    if (geometry.type === "MultiPolygon") {
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          paths.push(...positionsToSegmentPaths(ring, bbox));
        }
      }
    }
  }

  return paths;
}

function graticuleStep(span: number) {
  if (span <= 1) return 0.25;
  if (span <= 4) return 0.5;
  if (span <= 12) return 1;
  if (span <= 40) return 5;
  return 15;
}

function buildGraticulePaths(bbox: BoundingBox) {
  const paths: string[] = [];
  const lonStep = graticuleStep(bbox.maxLon - bbox.minLon);
  const latStep = graticuleStep(bbox.maxLat - bbox.minLat);
  const minLon = Math.ceil(bbox.minLon / lonStep) * lonStep;
  const minLat = Math.ceil(bbox.minLat / latStep) * latStep;

  for (let lon = minLon; lon <= bbox.maxLon; lon += lonStep) {
    const a = pointToSvgPoint([lon, bbox.minLat], bbox);
    const b = pointToSvgPoint([lon, bbox.maxLat], bbox);
    if (a && b) {
      paths.push(`M ${a.x.toFixed(3)} ${a.y.toFixed(3)} L ${b.x.toFixed(3)} ${b.y.toFixed(3)}`);
    }
  }

  for (let lat = minLat; lat <= bbox.maxLat; lat += latStep) {
    const a = pointToSvgPoint([bbox.minLon, lat], bbox);
    const b = pointToSvgPoint([bbox.maxLon, lat], bbox);
    if (a && b) {
      paths.push(`M ${a.x.toFixed(3)} ${a.y.toFixed(3)} L ${b.x.toFixed(3)} ${b.y.toFixed(3)}`);
    }
  }

  return paths;
}

function DetailedBoundaryOverlay({
  bbox,
  pan,
}: {
  bbox: BoundingBox;
  pan: { x: number; y: number };
}) {
  const [countryCollection, setCountryCollection] = useState<GeoJsonCollection | null>(null);
  const [admin1Collection, setAdmin1Collection] = useState<GeoJsonCollection | null>(null);
  const graticulePaths = useMemo(() => buildGraticulePaths(bbox), [bbox]);
  const admin1Paths = useMemo(() => collectionToPaths(admin1Collection, bbox), [admin1Collection, bbox]);
  const countryPaths = useMemo(() => collectionToPaths(countryCollection, bbox), [countryCollection, bbox]);

  useEffect(() => {
    let cancelled = false;

    fetchGeoJson(WORLD_GEOJSON_URLS)
      .then((collection) => {
        if (!cancelled) {
          setCountryCollection(collection);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCountryCollection(null);
        }
      });

    fetchGeoJson(ADMIN_1_GEOJSON_URLS)
      .then((collection) => {
        if (!cancelled) {
          setAdmin1Collection(collection);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAdmin1Collection(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[5]"
      preserveAspectRatio="none"
      viewBox={`0 0 ${BOUNDARY_SVG_VIEWBOX_SIZE} ${BOUNDARY_SVG_VIEWBOX_SIZE}`}
      style={{
        transform: `translate(${pan.x}px, ${pan.y}px)`,
      }}
    >
      {graticulePaths.map((path, index) => (
        <path
          key={`graticule-${index}`}
          d={path}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.16}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {admin1Paths.map((path, index) => (
        <path
          key={`admin1-${index}`}
          d={path}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.38}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {countryPaths.map((path, index) => (
        <path
          key={`country-${index}`}
          d={path}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.9}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export function MaxZoomImagery() {
  const globeView = useAppStore((state) => state.globeView);
  const date = useAppStore((state) => state.date);
  const layerId = useAppStore((state) => state.layerId);
  const imageryVisible = useAppStore((state) => state.imageryVisible);
  const boundaryLinesVisible = useAppStore((state) => state.boundaryLinesVisible);
  const modalOpen = useAppStore((state) => state.modalOpen);
  const focusGlobeAt = useAppStore((state) => state.focusGlobeAt);
  const selectPoint = useAppStore((state) => state.selectPoint);
  const paneRef = useRef<HTMLDivElement>(null);
  const imageCacheRef = useRef(new Map<string, string>());
  const objectUrlsRef = useRef(new Set<string>());
  const cacheScopeRef = useRef<string | null>(null);
  const visibleScopeRef = useRef<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [displayedBbox, setDisplayedBbox] = useState<BoundingBox | null>(null);
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
  const loadingMessage = provider.loadingMessage ?? "Loading detailed pass";
  const updatingMessage = provider.loadingMessage
    ? `Updating. ${provider.loadingMessage}`
    : "Updating";
  const isVisible = Boolean(imageryVisible && globeView?.atMaxZoom && !isSuppressed);
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
  const requestBbox = useMemo(() => bboxFromCacheKey(activeBboxKey), [activeBboxKey]);
  const cacheScope = activeBbox
    ? `${date}|${imageWidth}x${imageHeight}|${activeBboxKey}`
    : "";
  const labelBbox = displayedBbox ?? activeBbox;
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

  const clearImageCache = useCallback(() => {
    for (const cachedUrl of imageCacheRef.current.values()) {
      revokeImageUrl(cachedUrl);
    }

    imageCacheRef.current.clear();
  }, [revokeImageUrl]);

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

  useEffect(() => {
    if (!requestBbox || !isVisible) {
      return;
    }

    let cancelled = false;
    const nextCacheScope = cacheScope;
    const cacheKey = `${nextCacheScope}|${provider.id}`;
    const nextVisibleScope = cacheKey;

    if (cacheScopeRef.current !== nextCacheScope) {
      clearImageCache();
      cacheScopeRef.current = nextCacheScope;
    }

    if (visibleScopeRef.current !== nextVisibleScope) {
      setImageUrl(null);
      setDisplayedBbox(null);
      setPan({ x: 0, y: 0 });
      setCommittedPan({ x: 0, y: 0 });
      visibleScopeRef.current = nextVisibleScope;
    }

    setLoading(true);
    setError(null);
    setDragStart(null);

    const cachedImageUrl = imageCacheRef.current.get(cacheKey);

    if (cachedImageUrl) {
      setImageUrl(cachedImageUrl);
      setDisplayedBbox(requestBbox);
      setPan({ x: 0, y: 0 });
      setCommittedPan({ x: 0, y: 0 });
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    provider
      .fetchImage({ bbox: requestBbox, date, width: imageWidth, height: imageHeight })
      .then(async (result) => {
        if (cancelled) {
          return;
        }

        const nextImageUrl = createImageUrl(result);

        try {
          await preloadImage(nextImageUrl);
        } catch (error) {
          revokeImageUrl(nextImageUrl);
          throw error;
        }

        if (cancelled) {
          revokeImageUrl(nextImageUrl);
          return;
        }

        imageCacheRef.current.set(cacheKey, nextImageUrl);
        setImageUrl(nextImageUrl);
        setDisplayedBbox(requestBbox);
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
    revokeImageUrl,
  ]);

  useEffect(() => clearImageCache, [clearImageCache]);

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

    const sourceBbox = displayedBbox ?? activeBbox;

    if (!rect || !sourceBbox) {
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
              selectPoint(point.lat, point.lon, point.imageryView);
            }
          }}
          onPointerDown={(event) => {
            if (!bbox) {
              return;
            }

            if (event.shiftKey) {
              const point = pointFromImageEvent(event);

              if (point) {
                selectPoint(point.lat, point.lon, point.imageryView);
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

      {imageUrl && boundaryLinesVisible && labelBbox && (
        <DetailedBoundaryOverlay bbox={labelBbox} pan={pan} />
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
                  left: `calc(${left}% + ${pan.x}px)`,
                  top: `calc(${top}% + ${pan.y}px)`,
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
        <span className="text-muted-foreground">{formatCoordinates(globeView.lat, globeView.lon)}</span>
        <span className="text-muted-foreground">{formatApproxDistance(wideKm / 111)} wide</span>
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
