import { Activity, ChevronDown, ChevronUp, Flame, Layers, Mountain, Wind, X } from "lucide-react";
import { useEffect, useMemo } from "react";
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
  const layerId = useAppStore((state) => state.layerId);
  const overlayLayerIds = useAppStore((state) => state.overlayLayerIds);
  const modalOpen = useAppStore((state) => state.modalOpen);
  const atMaxZoom = useAppStore((state) => state.globeView?.atMaxZoom ?? false);
  const setLayer = useAppStore((state) => state.setLayer);
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
          provider.layerId &&
          provider.id !== layerId &&
          !overlayLayerIds.includes(provider.id),
      ),
    [layerId, overlayLayerIds],
  );

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

  if (modalOpen) {
    return null;
  }

  return (
    <aside className="pointer-events-auto absolute right-4 top-1/2 z-10 flex max-h-[calc(100vh-2rem)] w-[min(220px,calc(100vw-2rem))] -translate-y-1/2 flex-col overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-background/60 p-2.5 shadow-2xl backdrop-blur md:right-6">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-normal text-foreground">Imagery</h2>
        <span className="text-[11px] text-muted-foreground">
          1-{Math.min(9, visibleProviders.length)}
        </span>
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
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) {
                addOverlayLayer(event.target.value);
                event.target.value = "";
              }
            }}
            className="w-full rounded-md border border-white/10 bg-background/60 px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            aria-label="Add overlay"
          >
            <option value="">+ Add overlay…</option>
            {overlayCandidates.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
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
  );
}
