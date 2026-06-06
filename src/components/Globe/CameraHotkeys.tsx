import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Flame,
  Grid2x2X,
  Layers,
  LoaderCircle,
  Map,
  Mountain,
  Wind,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getImageryProvider, imageryProviders } from "@/providers/registry";
import { type ActivityOverlayKey, useAppStore } from "@/store/useAppStore";

const ACTIVITY_TOGGLES: { key: ActivityOverlayKey; label: string; icon: typeof Flame }[] = [
  { key: "earthquakes", label: "Earthquakes", icon: Activity },
  { key: "volcanoes", label: "Volcanoes", icon: Mountain },
  { key: "storms", label: "Storms", icon: Wind },
];

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function CameraHotkeys() {
  const overlayMenuRef = useRef<HTMLDivElement>(null);
  const [overlayMenuOpen, setOverlayMenuOpen] = useState(false);
  const [hoveredOverlayId, setHoveredOverlayId] = useState<string | null>(null);
  const layerId = useAppStore((state) => state.layerId);
  const imageryVisible = useAppStore((state) => state.imageryVisible);
  const boundaryLinesVisible = useAppStore((state) => state.boundaryLinesVisible);
  const overlayLayerIds = useAppStore((state) => state.overlayLayerIds);
  const overlayLoadStatuses = useAppStore((state) => state.overlayLoadStatuses);
  const modalOpen = useAppStore((state) => state.modalOpen);
  const atMaxZoom = useAppStore((state) => state.globeView?.atMaxZoom ?? false);
  const setLayer = useAppStore((state) => state.setLayer);
  const toggleImageryVisible = useAppStore((state) => state.toggleImageryVisible);
  const toggleBoundaryLinesVisible = useAppStore((state) => state.toggleBoundaryLinesVisible);
  const addOverlayLayer = useAppStore((state) => state.addOverlayLayer);
  const removeOverlayLayer = useAppStore((state) => state.removeOverlayLayer);
  const moveOverlayLayer = useAppStore((state) => state.moveOverlayLayer);
  const clearOverlayLayers = useAppStore((state) => state.clearOverlayLayers);
  const activityOverlays = useAppStore((state) => state.activityOverlays);
  const toggleActivityOverlay = useAppStore((state) => state.toggleActivityOverlay);
  const visibleProviders = useMemo(
    () =>
      imageryProviders.filter(
        (provider) => !provider.overlayOnly && (provider.layerId || atMaxZoom),
      ),
    [atMaxZoom],
  );
  const overlayCandidates = useMemo(
    () =>
      imageryProviders.filter(
        (provider) =>
          provider.overlayOnly &&
          provider.layerId &&
          provider.id !== layerId &&
          !overlayLayerIds.includes(provider.id),
      ),
    [layerId, overlayLayerIds],
  );
  const hoveredOverlay = hoveredOverlayId ? getImageryProvider(hoveredOverlayId) : null;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (modalOpen || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
        return;
      }

      const index = Number(event.key) - 1;

      if (!Number.isInteger(index) || index < 0 || index >= visibleProviders.length) {
        return;
      }

      event.preventDefault();
      setLayer(visibleProviders[index].id);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen, setLayer, visibleProviders]);

  useEffect(() => {
    if (!overlayMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        overlayMenuRef.current &&
        event.target instanceof Node &&
        !overlayMenuRef.current.contains(event.target)
      ) {
        setOverlayMenuOpen(false);
        setHoveredOverlayId(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOverlayMenuOpen(false);
        setHoveredOverlayId(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [overlayMenuOpen]);

  if (modalOpen) {
    return null;
  }

  return (
    <>
    <aside className="pointer-events-auto absolute right-4 top-1/2 z-10 flex max-h-[calc(100vh-2rem)] w-[min(220px,calc(100vw-2rem))] -translate-y-1/2 flex-col overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-background/60 p-2.5 shadow-2xl backdrop-blur md:right-6">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-normal text-foreground">Imagery</h2>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            1-{Math.min(9, visibleProviders.length)}
          </span>
          <button
            type="button"
            onClick={toggleImageryVisible}
            className={`inline-flex h-5 w-5 items-center justify-center rounded-sm border transition-colors ${
              imageryVisible
                ? "border-primary/60 bg-primary/20 text-foreground"
                : "border-white/10 bg-background/50 text-muted-foreground hover:text-foreground"
            }`}
            aria-label={imageryVisible ? "Hide base imagery" : "Show base imagery"}
            title={imageryVisible ? "Hide base imagery" : "Show base imagery"}
          >
            {imageryVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={toggleBoundaryLinesVisible}
            className={`inline-flex h-5 w-5 items-center justify-center rounded-sm border transition-colors ${
              boundaryLinesVisible
                ? "border-primary/60 bg-primary/20 text-foreground"
                : "border-white/10 bg-background/50 text-muted-foreground hover:text-foreground"
            }`}
            aria-label={boundaryLinesVisible ? "Hide boundary lines" : "Show boundary lines"}
            title={boundaryLinesVisible ? "Hide boundary lines" : "Show boundary lines"}
          >
            {boundaryLinesVisible ? <Map className="h-3 w-3" /> : <Grid2x2X className="h-3 w-3" />}
          </button>
        </div>
      </div>
      <div className="space-y-0.5">
        {visibleProviders.map((provider, index) => {
          const selected = provider.id === layerId;

          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => setLayer(provider.id)}
              className={`flex w-full items-center gap-2 rounded-md border px-1.5 py-1 text-left text-[11px] transition-colors ${
                selected
                  ? "border-primary/60 bg-primary/20 text-foreground"
                  : "border-transparent text-muted-foreground hover:border-white/10 hover:bg-white/5 hover:text-foreground"
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[10px] font-semibold ${
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-white/15 bg-background/60 text-muted-foreground"
                }`}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium leading-tight">{provider.name}</span>
                <span className="block truncate text-[10px] leading-tight opacity-75">
                  {provider.category}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-normal text-foreground">
            <Layers className="h-3 w-3" />
            Overlays
          </h3>
          {overlayLayerIds.length > 0 ? (
            <button
              type="button"
              onClick={clearOverlayLayers}
              className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-white/5 hover:text-foreground"
              aria-label="Clear all overlays"
            >
              <X className="h-2.5 w-2.5" />
              Clear
            </button>
          ) : null}
        </div>
        {overlayLayerIds.length > 0 ? (
          <ul className="mb-1.5 space-y-0.5">
            {overlayLayerIds.map((id, index) => {
              const provider = getImageryProvider(id);
              const isFirst = index === 0;
              const isLast = index === overlayLayerIds.length - 1;
              const loadStatus = overlayLoadStatuses[id]?.state ?? "loading";
              const isLoaded = loadStatus === "loaded";

              return (
                <li
                  key={id}
                  className="flex items-center gap-1 rounded-md border border-white/10 bg-background/40 px-1 py-1 text-[11px]"
                >
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => moveOverlayLayer(id, "up")}
                      disabled={isFirst}
                      className="text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label={`Move ${provider.name} up`}
                    >
                      <ChevronUp className="h-2.5 w-2.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveOverlayLayer(id, "down")}
                      disabled={isLast}
                      className="text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label={`Move ${provider.name} down`}
                    >
                      <ChevronDown className="h-2.5 w-2.5" />
                    </button>
                  </div>
                  <span
                    className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                      isLoaded
                        ? "border-primary/35 bg-primary/10 text-primary"
                        : "border-white/10 bg-background/50 text-muted-foreground"
                    }`}
                    title={isLoaded ? `${provider.name} overlay loaded` : `Loading ${provider.name} overlay`}
                    aria-label={isLoaded ? `${provider.name} overlay loaded` : `Loading ${provider.name} overlay`}
                  >
                    {isLoaded ? (
                      <CheckCircle2 className="h-2.5 w-2.5" />
                    ) : (
                      <LoaderCircle className="h-2.5 w-2.5 animate-spin" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium leading-tight text-foreground">
                    {provider.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeOverlayLayer(id)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={`Remove ${provider.name}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {overlayCandidates.length > 0 ? (
          <div ref={overlayMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setOverlayMenuOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-white/10 bg-background/60 px-2 py-1 text-left text-[11px] text-foreground transition-colors hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary"
              aria-expanded={overlayMenuOpen}
              aria-haspopup="listbox"
            >
              <span>+ Add overlay...</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
            {overlayMenuOpen ? (
              <div
                className="absolute bottom-[calc(100%+0.35rem)] left-0 z-20 max-h-[min(48vh,360px)] w-[min(280px,calc(100vw-2rem))] overflow-y-auto rounded-md border border-white/15 bg-popover/95 p-1 shadow-2xl backdrop-blur"
                role="listbox"
                aria-label="Add overlay"
                onMouseLeave={() => setHoveredOverlayId(null)}
              >
                {overlayCandidates.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    role="option"
                    onClick={() => {
                      addOverlayLayer(provider.id);
                      setOverlayMenuOpen(false);
                      setHoveredOverlayId(null);
                    }}
                    onFocus={() => setHoveredOverlayId(provider.id)}
                    onMouseEnter={() => setHoveredOverlayId(provider.id)}
                    className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-primary/20 hover:text-foreground focus:bg-primary/20 focus:text-foreground focus:outline-none"
                  >
                    <span className="font-medium leading-tight">{provider.name}</span>
                    <span className="text-[10px] leading-tight opacity-75">
                      {provider.category} · {provider.resolution}m
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-2 border-t border-white/10 pt-2">
        <h3 className="mb-1.5 text-[11px] font-semibold tracking-normal text-foreground">
          Activity
        </h3>
        <div className="space-y-0.5">
          {ACTIVITY_TOGGLES.map(({ key, label, icon: Icon }) => {
            const active = activityOverlays[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleActivityOverlay(key)}
                aria-pressed={active}
                className={`flex w-full items-center gap-2 rounded-md border px-1.5 py-1 text-left text-[11px] transition-colors ${
                  active
                    ? "border-primary/60 bg-primary/20 text-foreground"
                    : "border-transparent text-muted-foreground hover:border-white/10 hover:bg-white/5 hover:text-foreground"
                }`}
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium leading-tight">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
    {hoveredOverlay && overlayMenuOpen ? (
      <div
        className="pointer-events-none fixed left-1/2 top-1/2 z-20 w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/25 p-4 text-sm text-white shadow-2xl ring-1 ring-black"
        style={{ backgroundColor: "#05070d" }}
      >
        <div className="mb-2 flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold leading-tight text-white">
              {hoveredOverlay.name}
            </div>
            <div className="mt-1 text-xs text-white/70">
              {hoveredOverlay.satellite} · {hoveredOverlay.category} · {hoveredOverlay.resolution}m nominal
            </div>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-white/90">{hoveredOverlay.summary}</p>
        <div className="mt-3 space-y-2 border-t border-white/15 pt-3 text-xs leading-relaxed text-white/75">
          <p>
            <span className="font-medium text-white">Best for: </span>
            {hoveredOverlay.bestFor}
          </p>
          <p>
            <span className="font-medium text-white">Watch for: </span>
            {hoveredOverlay.caveat}
          </p>
        </div>
      </div>
    ) : null}
    </>
  );
}
