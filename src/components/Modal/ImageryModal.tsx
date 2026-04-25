import { ArrowLeft, Film, LoaderCircle, MapPinned, Satellite, Sparkles } from "lucide-react";
import {
  type PointerEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  bboxFromPoint,
  bboxHeightKm,
  bboxWidthKm,
  clamp,
  formatApproxDistance,
  formatCoordinates,
  normalizeLongitude,
  zoomPercentToDegrees,
  degreesToZoomPercent,
} from "@/lib/geo";
import {
  formatExactCaptureTime,
  formatGibsCaptureTime,
  formatSentinelCaptureTime,
} from "@/lib/captureTime";
import { getRecentIsoDates } from "@/lib/dates";
import { getSentinelVariant, sentinelVariants } from "@/lib/sentinelVariants";
import { getImageryProvider, imageryProviders } from "@/providers/registry";
import { useAppStore } from "@/store/useAppStore";
import type { BoundingBox } from "@/types/imagery";
import { DatePicker } from "./DatePicker";
import { ImageryInfoButton, ImageryInfoModal } from "./ImageryInfoModal";
import { LayerSwitcher } from "./LayerSwitcher";
import { SentinelWorkspace, type SentinelViewport } from "./SentinelWorkspace";
import { TimeLapseModal, type TimeLapseFrame } from "./TimeLapseModal";

type ModalMode = "regional" | "sentinel";

type SentinelState = {
  imageUrl: string;
  bbox: BoundingBox;
  variantId: string;
  sceneDateTime?: string;
} | null;

type SentinelScene = {
  dateTime: string;
  cloudCover: number | null;
  itemIds: string[];
};

const SENTINEL_DEFAULT_SIZE_DEGREES = 0.09;
const SENTINEL_RENDER_SIZE = 1024;
const SENTINEL_SCENE_LOOKBACK_DAYS = 730;
const TIME_LAPSE_SPEEDS = {
  7: 650,
  30: 180,
};

type SentinelTimeLapseCacheValue = {
  frames: TimeLapseFrame[];
  error: string | null;
};

function bboxFromSpans(lat: number, lon: number, latSpan: number, lonSpan: number): BoundingBox {
  return {
    minLat: clamp(lat - latSpan / 2, -85, 85),
    maxLat: clamp(lat + latSpan / 2, -85, 85),
    minLon: clamp(lon - lonSpan / 2, -180, 180),
    maxLon: clamp(lon + lonSpan / 2, -180, 180),
  };
}

function sentinelTimeLapseBboxKey(bbox: BoundingBox) {
  return [
    bbox.minLat,
    bbox.minLon,
    bbox.maxLat,
    bbox.maxLon,
  ]
    .map((value) => value.toFixed(6))
    .join(",");
}

export function ImageryModal() {
  const {
    selectedPoint,
    modalOpen,
    date,
    layerId,
    imageryZoomDegrees,
    closeModal,
    setDate,
    setLayer,
    setImageryZoomDegrees,
    recenterPoint,
  } = useAppStore();
  const imagePaneRef = useRef<HTMLDivElement | null>(null);
  const wasModalOpenRef = useRef(false);
  const imageScopeRef = useRef<string | null>(null);
  const sentinelTimeLapseCacheRef = useRef(new Map<string, SentinelTimeLapseCacheValue>());
  const sentinelTimeLapseScopeRef = useRef<string | null>(null);
  const [imagePaneNode, setImagePaneNode] = useState<HTMLDivElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeLapseOpen, setTimeLapseOpen] = useState(false);
  const [timeLapseFrames, setTimeLapseFrames] = useState<TimeLapseFrame[]>([]);
  const [timeLapseLoading, setTimeLapseLoading] = useState(false);
  const [timeLapseError, setTimeLapseError] = useState<string | null>(null);
  const [timeLapseDays, setTimeLapseDays] = useState<7 | 30>(7);
  const [previewZoomDegrees, setPreviewZoomDegrees] = useState(imageryZoomDegrees);
  const [loadedImageZoomDegrees, setLoadedImageZoomDegrees] = useState(imageryZoomDegrees);
  const [infoOpen, setInfoOpen] = useState(false);
  const [mode, setMode] = useState<ModalMode>("regional");
  const [sentinelVariantId, setSentinelVariantId] = useState(sentinelVariants[0].id);
  const [sentinelState, setSentinelState] = useState<SentinelState>(null);
  const [sentinelLoading, setSentinelLoading] = useState(false);
  const [sentinelError, setSentinelError] = useState<string | null>(null);
  const [sentinelViewport, setSentinelViewport] = useState<SentinelViewport>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [regionalPan, setRegionalPan] = useState({ x: 0, y: 0 });
  const [committedRegionalPan, setCommittedRegionalPan] = useState({ x: 0, y: 0 });
  const [imagePaneSize, setImagePaneSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const zoomCommitTimerRef = useRef<number | null>(null);
  const [regionalDragStart, setRegionalDragStart] = useState<{
    pointerId: number;
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);

  const provider = getImageryProvider(layerId);
  const selectedLat = selectedPoint?.lat;
  const selectedLon = selectedPoint?.lon;
  const hasImageryView = Boolean(selectedPoint?.imageryView);
  const setImagePaneRef = useCallback((node: HTMLDivElement | null) => {
    imagePaneRef.current = node;
    setImagePaneNode(node);
  }, []);
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

  useLayoutEffect(() => {
    if (!modalOpen) {
      setImagePaneSize(null);
      return;
    }

    if (!imagePaneNode) {
      return;
    }

    const currentPane = imagePaneNode;

    function updatePaneSize() {
      const rect = currentPane.getBoundingClientRect();
      const nextSize = {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      setImagePaneSize((previous) =>
        previous?.width === nextSize.width && previous.height === nextSize.height
          ? previous
          : nextSize,
      );
    }

    updatePaneSize();

    const observer = new ResizeObserver(updatePaneSize);
    observer.observe(currentPane);

    return () => observer.disconnect();
  }, [imagePaneNode, modalOpen]);

  function preloadImage(url: string) {
    return new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = reject;
      image.src = url;
    });
  }

  async function loadTimeLapse(dayCount: 7 | 30) {
    if (!bbox) {
      return;
    }

    const frameDates = getRecentIsoDates(date, dayCount);
    setTimeLapseDays(dayCount);
    setTimeLapseOpen(true);
    setTimeLapseFrames([]);
    setTimeLapseError(null);
    setTimeLapseLoading(true);

    const frames = await Promise.allSettled(
      frameDates.map(async (frameDate) => {
        const result = await provider.fetchImage({
          bbox,
          date: frameDate,
          width: 1024,
          height: 1024,
        });
        const imageUrl = typeof result === "string" ? result : URL.createObjectURL(result);

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

    setTimeLapseFrames(loadedFrames);
    setTimeLapseLoading(false);

    if (loadedFrames.length === 0) {
      setTimeLapseError(`No imagery frames were available for this ${dayCount}-day view.`);
    } else if (loadedFrames.length < frameDates.length) {
      setTimeLapseError("Some daily frames were unavailable, so the sequence is partial.");
    }
  }

  function getSentinelTimeLapseScope() {
    if (!sentinelState) {
      return null;
    }

    return [
      date,
      sentinelState.variantId,
      sentinelTimeLapseBboxKey(sentinelState.bbox),
      sentinelViewport.scale.toFixed(3),
      sentinelViewport.x.toFixed(1),
      sentinelViewport.y.toFixed(1),
    ].join("|");
  }

  async function loadSentinelTimeLapse(dayCount: 7 | 30) {
    if (!sentinelState) {
      return;
    }

    const variant = getSentinelVariant(sentinelState.variantId);
    const cacheScope = getSentinelTimeLapseScope();
    const cacheKey = cacheScope ? `${cacheScope}|${dayCount}` : null;
    const cached = cacheKey ? sentinelTimeLapseCacheRef.current.get(cacheKey) : undefined;

    setTimeLapseDays(dayCount);
    setTimeLapseOpen(true);

    if (cached) {
      setTimeLapseFrames(cached.frames);
      setTimeLapseError(cached.error);
      setTimeLapseLoading(false);
      return;
    }

    setTimeLapseFrames([]);
    setTimeLapseError(null);
    setTimeLapseLoading(true);

    try {
      const scenesResponse = await fetch("/api/sentinel-scenes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          bbox: sentinelState.bbox,
          date,
          variantId: variant.id,
          limit: dayCount,
          lookbackDays: SENTINEL_SCENE_LOOKBACK_DAYS,
        }),
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
      const distinctScenes = (scenes ?? [])
        .slice()
        .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

      if (distinctScenes.length === 0) {
        setTimeLapseFrames([]);
        setTimeLapseLoading(false);
        setTimeLapseError(`No distinct ${variant.name} scenes were found for this view.`);
        if (cacheKey) {
          sentinelTimeLapseCacheRef.current.set(cacheKey, {
            frames: [],
            error: `No distinct ${variant.name} scenes were found for this view.`,
          });
        }
        return;
      }

      const sceneFrames = await Promise.allSettled(
        distinctScenes.map(async (scene) => {
          const response = await fetch("/api/sentinel-image", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              bbox: sentinelState.bbox,
              date,
              sceneDateTime: scene.dateTime,
              variantId: variant.id,
              width: SENTINEL_RENDER_SIZE,
              height: SENTINEL_RENDER_SIZE,
            }),
          });

          if (!response.ok) {
            throw new Error(`${variant.name} imagery is unavailable for ${scene.dateTime}.`);
          }

          const imageUrl = URL.createObjectURL(await response.blob());
          await preloadImage(imageUrl);

          return {
            date: scene.dateTime,
            imageUrl,
          };
        }),
      );
      const loadedSceneFrames = sceneFrames
        .filter(
          (frame): frame is PromiseFulfilledResult<TimeLapseFrame> =>
            frame.status === "fulfilled",
        )
        .map((frame) => frame.value);

      setTimeLapseFrames(loadedSceneFrames);
      setTimeLapseLoading(false);

      let nextError: string | null = null;

      if (loadedSceneFrames.length === 0) {
        nextError = `No ${variant.name} scene frames were available for this view.`;
      } else if (loadedSceneFrames.length < distinctScenes.length) {
        nextError = "Some Sentinel scene frames were unavailable, so the sequence is partial.";
      } else if (loadedSceneFrames.length < dayCount) {
        nextError = `Only ${loadedSceneFrames.length} distinct scenes were found in the latest available imagery.`;
      }

      setTimeLapseError(nextError);

      if (cacheKey) {
        sentinelTimeLapseCacheRef.current.set(cacheKey, {
          frames: loadedSceneFrames,
          error: nextError,
        });
      }
    } catch (sceneError) {
      setTimeLapseFrames([]);
      setTimeLapseLoading(false);
      setTimeLapseError(
        sceneError instanceof Error ? sceneError.message : "Sentinel scene search failed.",
      );
    }
  }

  async function fetchLatestSentinelScene(sentinelBbox: BoundingBox, variantId: string) {
    const variant = getSentinelVariant(variantId);
    const response = await fetch("/api/sentinel-scenes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        bbox: sentinelBbox,
        date,
        variantId: variant.id,
        limit: 1,
        lookbackDays: variant.requestWindowDays,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const { scenes } = (await response.json()) as { scenes?: SentinelScene[] };
    return scenes?.[0] ?? null;
  }

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

    if (imageScopeRef.current !== nextImageScope) {
      setImageUrl(null);
      setRegionalPan({ x: 0, y: 0 });
      setCommittedRegionalPan({ x: 0, y: 0 });
      imageScopeRef.current = nextImageScope;
    }

    setImageLoading(true);
    setError(null);
    setRegionalDragStart(null);
    setMode("regional");
    setSentinelState(null);
    setSentinelError(null);
    setSentinelViewport({ scale: 1, x: 0, y: 0 });

    async function loadRegionalImage(requestBbox: BoundingBox) {
      const result = await provider.fetchImage({
        bbox: requestBbox,
        date,
        width: regionalImageWidth,
        height: regionalImageHeight,
      });
      const nextImageUrl = typeof result === "string" ? result : URL.createObjectURL(result);
      await preloadImage(nextImageUrl);

      return nextImageUrl;
    }

    loadRegionalImage(bbox)
      .then(async (result) => {
        if (cancelled) {
          return;
        }

        setImageUrl(result);
        setLoadedImageZoomDegrees(requestZoomDegrees);
        setPreviewZoomDegrees(requestZoomDegrees);
        setRegionalPan({ x: 0, y: 0 });
        setCommittedRegionalPan({ x: 0, y: 0 });
        setImageLoading(false);
      })
      .catch(async () => {
        if (!hasImageryView || !fallbackBbox) {
          if (!cancelled) {
            setError("Imagery unavailable for this selection.");
            setImageLoading(false);
          }

          return;
        }

        try {
          const fallbackImageUrl = await loadRegionalImage(fallbackBbox);

          if (!cancelled) {
            setImageUrl(fallbackImageUrl);
            setLoadedImageZoomDegrees(requestZoomDegrees);
            setPreviewZoomDegrees(requestZoomDegrees);
            setRegionalPan({ x: 0, y: 0 });
            setCommittedRegionalPan({ x: 0, y: 0 });
            setImageLoading(false);
          }
        } catch {
          if (!cancelled) {
            setError("Imagery unavailable for this selection.");
            setImageLoading(false);
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    bbox,
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

  useEffect(() => {
    const nextScope = sentinelState
      ? [
          date,
          sentinelState.variantId,
          sentinelTimeLapseBboxKey(sentinelState.bbox),
          sentinelViewport.scale.toFixed(3),
          sentinelViewport.x.toFixed(1),
          sentinelViewport.y.toFixed(1),
        ].join("|")
      : null;

    if (sentinelTimeLapseScopeRef.current === nextScope) {
      return;
    }

    sentinelTimeLapseScopeRef.current = nextScope;
    sentinelTimeLapseCacheRef.current.clear();
  }, [date, sentinelState, sentinelViewport.scale, sentinelViewport.x, sentinelViewport.y]);

  useEffect(() => {
    if (!modalOpen || mode !== "regional") {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target;

      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      const index = Number(event.key) - 1;

      if (!Number.isInteger(index) || index < 0 || index >= imageryProviders.length) {
        return;
      }

      event.preventDefault();
      setLayer(imageryProviders[index].id);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen, mode, setLayer]);

  const coordinates = selectedPoint
    ? formatCoordinates(selectedPoint.lat, selectedPoint.lon)
    : "";
  const regionalCaptureLabel = formatGibsCaptureTime(date, provider.id, selectedLon);
  const imagePreviewScale = loadedImageZoomDegrees / previewZoomDegrees;
  const selectedSentinelVariant = getSentinelVariant(sentinelVariantId);
  const renderedSentinelVariant = getSentinelVariant(sentinelState?.variantId);
  const sentinelCaptureLabel = formatSentinelCaptureTime(
    date,
    renderedSentinelVariant.id,
    selectedLon,
  );
  const captureLabel =
    mode === "sentinel" && sentinelState?.sceneDateTime
      ? formatExactCaptureTime(sentinelState.sceneDateTime)
      : mode === "sentinel"
        ? sentinelCaptureLabel
        : regionalCaptureLabel;
  const defaultSentinelVariant = sentinelVariants[0];

  function expandBboxToNativeLimit(inputBbox: BoundingBox, nativeMeters: number) {
    const widthKm = bboxWidthKm(inputBbox);
    const heightKm = bboxHeightKm(inputBbox);
    const currentMaxKm = Math.max(widthKm, heightKm);
    const minNativeKm = (nativeMeters * SENTINEL_RENDER_SIZE) / 1000;

    if (currentMaxKm >= minNativeKm || currentMaxKm <= 0) {
      return inputBbox;
    }

    const scale = minNativeKm / currentMaxKm;
    const centerLat = (inputBbox.minLat + inputBbox.maxLat) / 2;
    const centerLon = normalizeLongitude((inputBbox.minLon + inputBbox.maxLon) / 2);
    const nextLatSpan = (inputBbox.maxLat - inputBbox.minLat) * scale;
    const nextLonSpan = (inputBbox.maxLon - inputBbox.minLon) * scale;

    return {
      minLat: clamp(centerLat - nextLatSpan / 2, -85, 85),
      maxLat: clamp(centerLat + nextLatSpan / 2, -85, 85),
      minLon: clamp(centerLon - nextLonSpan / 2, -180, 180),
      maxLon: clamp(centerLon + nextLonSpan / 2, -180, 180),
    };
  }

  async function requestSentinelImage(
    sentinelBbox: BoundingBox,
    variantId = sentinelVariantId,
  ) {
    if (!selectedPoint) {
      return;
    }

    const variant = getSentinelVariant(variantId);
    setSentinelVariantId(variant.id);
    setSentinelLoading(true);
    setSentinelError(null);

    try {
      const scene = await fetchLatestSentinelScene(sentinelBbox, variant.id);
      const response = await fetch("/api/sentinel-image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          bbox: sentinelBbox,
          date,
          sceneDateTime: scene?.dateTime,
          variantId: variant.id,
          width: SENTINEL_RENDER_SIZE,
          height: SENTINEL_RENDER_SIZE,
        }),
      });

      if (!response.ok) {
        let message = `${variant.name} imagery is unavailable for this area/date.`;

        try {
          const body = (await response.json()) as { error?: string };
          message = body.error ?? message;
        } catch {
          message = await response.text();
        }

        throw new Error(message);
      }

      const blob = await response.blob();
      setSentinelState({
        imageUrl: URL.createObjectURL(blob),
        bbox: sentinelBbox,
        variantId: variant.id,
        sceneDateTime: scene?.dateTime,
      });
      setSentinelVariantId(variant.id);
      setSentinelViewport({ scale: 1, x: 0, y: 0 });
      setMode("sentinel");
    } catch (requestError) {
      setSentinelError(
        requestError instanceof Error
          ? requestError.message
          : `${variant.name} image request failed.`,
      );
    } finally {
      setSentinelLoading(false);
    }
  }

  async function renderSentinelImage(center = selectedPoint) {
    if (!bbox || !center) {
      return;
    }

    await requestSentinelImage(
      expandBboxToNativeLimit(
        bboxFromPoint(
          center.lat,
          center.lon,
          Math.min(imageryZoomDegrees, SENTINEL_DEFAULT_SIZE_DEGREES),
        ),
        defaultSentinelVariant.resolution,
      ),
      defaultSentinelVariant.id,
    );
  }

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

  function sentinelBboxForViewport(viewport: SentinelViewport, respectNativeLimit = false) {
    if (!sentinelState) {
      return null;
    }

    const rect = imagePaneRef.current?.getBoundingClientRect();

    if (!rect) {
      return sentinelState.bbox;
    }

    const sourceBbox = sentinelState.bbox;
    const sourceLat = (sourceBbox.minLat + sourceBbox.maxLat) / 2;
    const sourceLon = normalizeLongitude((sourceBbox.minLon + sourceBbox.maxLon) / 2);
    const scale = viewport.scale || 1;
    const lonSpan = sourceBbox.maxLon - sourceBbox.minLon;
    const latSpan = sourceBbox.maxLat - sourceBbox.minLat;
    const nextLonSpan = lonSpan / scale;
    const nextLatSpan = latSpan / scale;
    const nextLat = clamp(
      sourceLat + (viewport.y / (rect.height * scale)) * latSpan,
      -85,
      85,
    );
    const nextLon = normalizeLongitude(
      sourceLon - (viewport.x / (rect.width * scale)) * lonSpan,
    );

    const nextBbox = {
      minLat: clamp(nextLat - nextLatSpan / 2, -85, 85),
      maxLat: clamp(nextLat + nextLatSpan / 2, -85, 85),
      minLon: clamp(nextLon - nextLonSpan / 2, -180, 180),
      maxLon: clamp(nextLon + nextLonSpan / 2, -180, 180),
    };

    return respectNativeLimit
      ? expandBboxToNativeLimit(nextBbox, renderedSentinelVariant.resolution)
      : nextBbox;
  }

  async function commitSentinelPan(viewport: SentinelViewport) {
    if (sentinelLoading || !sentinelState) {
      return;
    }

    const variantId = sentinelState.variantId;
    const nextBbox = sentinelBboxForViewport(viewport, true);

    if (!nextBbox) {
      return;
    }

    await requestSentinelImage(nextBbox, variantId);
  }

  async function refineSentinelView() {
    if (sentinelLoading || !sentinelState) {
      return;
    }

    const variantId = sentinelState.variantId;
    const nextBbox = sentinelBboxForViewport(sentinelViewport, true);

    if (!nextBbox) {
      return;
    }

    await requestSentinelImage(nextBbox, variantId);
  }

  async function changeSentinelVariant(nextVariantId: string) {
    setSentinelVariantId(nextVariantId);

    if (sentinelLoading || !sentinelState) {
      return;
    }

    const nextVariant = getSentinelVariant(nextVariantId);
    await requestSentinelImage(
      expandBboxToNativeLimit(sentinelState.bbox, nextVariant.resolution),
      nextVariant.id,
    );
  }

  function exitSentinelMode() {
    setMode("regional");
    setSentinelError(null);
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
    recenterPoint(nextLat, nextLon);
  }

  function previewRegionalZoom(nextDegrees: number) {
    setPreviewZoomDegrees(nextDegrees);

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

  const sentinelWidth = sentinelState ? bboxWidthKm(sentinelState.bbox) : 0;
  const sentinelHeight = sentinelState ? bboxHeightKm(sentinelState.bbox) : 0;
  const sentinelNativeMeters = sentinelState
    ? (Math.max(sentinelWidth, sentinelHeight) * 1000) / SENTINEL_RENDER_SIZE
    : 0;
  const refinedSentinelBbox = sentinelState
    ? sentinelBboxForViewport(sentinelViewport, true)
    : null;
  const refinedSentinelMeters = refinedSentinelBbox
    ? (Math.max(bboxWidthKm(refinedSentinelBbox), bboxHeightKm(refinedSentinelBbox)) * 1000) /
      SENTINEL_RENDER_SIZE
    : 0;
  const canRefineSentinel =
    sentinelViewport.scale > 1.01 &&
    refinedSentinelBbox !== null &&
    Math.abs(refinedSentinelMeters - sentinelNativeMeters) > 0.2;

  return (
    <Dialog open={modalOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent data-testid="imagery-modal">
        <div className="grid max-h-[92dvh] grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
          <div
            ref={setImagePaneRef}
            className="relative min-h-[360px] overflow-hidden bg-black lg:min-h-[680px]"
          >
            {mode === "sentinel" && sentinelState ? (
              <SentinelWorkspace
                imageUrl={sentinelState.imageUrl}
                bbox={sentinelState.bbox}
                onViewportChange={setSentinelViewport}
                onPanCommit={(viewport) => void commitSentinelPan(viewport)}
              />
            ) : imageUrl ? (
              <img
                key={imageUrl}
                src={imageUrl}
                alt=""
                data-testid="gibs-image"
                draggable={false}
                className="h-full w-full cursor-grab select-none object-cover active:cursor-grabbing"
                style={{
                  transform: `translate(${regionalPan.x}px, ${regionalPan.y}px) scale(${imagePreviewScale})`,
                  transformOrigin: "center",
                  transition:
                    regionalDragStart || imageLoading
                      ? "none"
                      : "transform 160ms ease-out",
                }}
                onWheel={zoomRegionalImage}
                onPointerDown={(event) => {
                  if (event.shiftKey) {
                    const point = pointFromRegionalEvent(event);

                    if (point) {
                      void renderSentinelImage(point);
                    }

                    return;
                  }

                  event.currentTarget.setPointerCapture(event.pointerId);
                  setRegionalDragStart({
                    pointerId: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    originX: committedRegionalPan.x,
                    originY: committedRegionalPan.y,
                  });
                }}
                onPointerMove={(event) => {
                  if (!regionalDragStart || regionalDragStart.pointerId !== event.pointerId) {
                    return;
                  }

                  setRegionalPan({
                    x: regionalDragStart.originX + event.clientX - regionalDragStart.x,
                    y: regionalDragStart.originY + event.clientY - regionalDragStart.y,
                  });
                }}
                onPointerUp={(event) => {
                  const nextPan = regionalDragStart
                    ? {
                        x: regionalDragStart.originX + event.clientX - regionalDragStart.x,
                        y: regionalDragStart.originY + event.clientY - regionalDragStart.y,
                      }
                    : regionalPan;

                  setRegionalDragStart(null);
                  commitRegionalPan(nextPan);
                }}
                onPointerCancel={() => {
                  setRegionalDragStart(null);
                  setRegionalPan(committedRegionalPan);
                }}
                onLoad={() => setImageLoading(false)}
                onError={() => {
                  setError("Imagery unavailable for this selection.");
                  setImageLoading(false);
                }}
              />
            ) : null}
            {!imageUrl && imageLoading && !error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}
            {imageUrl && imageLoading && mode === "regional" && !error && (
              <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-md border border-white/10 bg-black/55 px-2 py-1 text-xs text-white/85 backdrop-blur">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
                Updating
              </div>
            )}
            {sentinelLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                <div className="flex items-center gap-2 rounded-md border border-white/10 bg-background/80 px-3 py-2 text-sm shadow-xl backdrop-blur">
                  <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                  Rendering {selectedSentinelVariant.name}
                </div>
              </div>
            )}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-8 text-center text-sm text-muted-foreground">
                {error}
              </div>
            )}
          </div>

          <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto border-t border-border bg-card p-5 lg:border-l lg:border-t-0">
            <DialogHeader className="pr-7">
              <DialogTitle className="flex items-center gap-2">
                <MapPinned className="h-5 w-5 text-primary" />
                {coordinates}
              </DialogTitle>
              <DialogDescription>{captureLabel}</DialogDescription>
            </DialogHeader>

            <div className="rounded-md border border-border bg-background/45 p-4">
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                <Satellite className="h-4 w-4 text-primary" />
                {mode === "sentinel" ? renderedSentinelVariant.name : provider.name}
              </div>
              <div className="text-sm text-muted-foreground">
                {mode === "sentinel"
                  ? `Copernicus · ${renderedSentinelVariant.resolution}m ${renderedSentinelVariant.category}`
                  : `${provider.satellite} · ${provider.resolution}m nominal`}
              </div>
            </div>

            {mode === "sentinel" && sentinelState ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={exitSentinelMode}
                  className="w-full"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to regional view
                </Button>

                <div className="space-y-2">
                  <Label htmlFor="sentinel-variant" className="inline-flex items-center gap-2">
                    <Satellite className="h-3.5 w-3.5" />
                    Sentinel layer
                  </Label>
                  <Select
                    value={sentinelVariantId}
                    onValueChange={(value) => void changeSentinelVariant(value)}
                  >
                    <SelectTrigger id="sentinel-variant">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sentinelVariants.map((variant) => (
                        <SelectItem key={variant.id} value={variant.id}>
                          {variant.shortName} · {variant.category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {selectedSentinelVariant.caveat}
                  </p>
                </div>

                <DatePicker value={date} onChange={setDate} />

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void loadSentinelTimeLapse(7)}
                    disabled={timeLapseLoading || !sentinelState}
                    className="w-full"
                  >
                    {timeLapseLoading && timeLapseDays === 7 ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Film className="h-4 w-4" />
                    )}
                    7 scenes
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void loadSentinelTimeLapse(30)}
                    disabled={timeLapseLoading || !sentinelState}
                    className="w-full"
                  >
                    {timeLapseLoading && timeLapseDays === 30 ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Film className="h-4 w-4" />
                    )}
                    30 scenes
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={refineSentinelView}
                  disabled={sentinelLoading || !canRefineSentinel}
                  className="w-full"
                >
                  {sentinelLoading ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Refine current Sentinel view
                </Button>

                <div className="rounded-md border border-border bg-background/45 p-4 text-sm text-muted-foreground">
                  <div className="mb-2 font-medium text-foreground">Sentinel workspace</div>
                  <div>Area: {formatApproxDistance(Math.max(sentinelWidth, sentinelHeight) / 111)} wide</div>
                  <div>
                    Request scale: ~{sentinelNativeMeters.toFixed(1)}m/px
                    {sentinelNativeMeters < renderedSentinelVariant.resolution
                      ? " (native limit)"
                      : ""}
                  </div>
                  <div className="mt-3 leading-relaxed">
                    Drag the image to pan. Use wheel or trackpad scroll to zoom client-side. A
                    later refine action can request a new image for the current view.
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void renderSentinelImage()}
                    disabled={sentinelLoading || !bbox}
                    className="w-full"
                  >
                    {sentinelLoading ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    Render Sentinel-2 high-res
                  </Button>
                  {sentinelError && (
                    <p className="text-xs leading-relaxed text-destructive">{sentinelError}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void loadTimeLapse(7)}
                    disabled={timeLapseLoading || !bbox}
                    className="w-full"
                  >
                    {timeLapseLoading && timeLapseDays === 7 ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Film className="h-4 w-4" />
                    )}
                    7 days
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void loadTimeLapse(30)}
                    disabled={timeLapseLoading || !bbox}
                    className="w-full"
                  >
                    {timeLapseLoading && timeLapseDays === 30 ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Film className="h-4 w-4" />
                    )}
                    30 days
                  </Button>
                </div>

                <LayerSwitcher
                  value={layerId}
                  onValueChange={setLayer}
                  action={<ImageryInfoButton onClick={() => setInfoOpen(true)} />}
                />
                <DatePicker value={date} onChange={setDate} />
              </>
            )}
          </aside>
        </div>
      </DialogContent>
      <ImageryInfoModal open={infoOpen} onOpenChange={setInfoOpen} />
      <TimeLapseModal
        open={timeLapseOpen}
        onOpenChange={setTimeLapseOpen}
        frames={timeLapseFrames}
        loading={timeLapseLoading}
        error={timeLapseError}
        title={
          mode === "sentinel"
            ? `${renderedSentinelVariant.name} · ${timeLapseDays} scenes`
            : `${provider.name} · ${timeLapseDays} days`
        }
        frameCountLabel={mode === "sentinel" ? "scene frames" : undefined}
        frameIntervalMs={TIME_LAPSE_SPEEDS[timeLapseDays]}
      />
    </Dialog>
  );
}
