import { useEffect } from "react";
import { imageryProviders } from "@/providers/registry";
import { useAppStore } from "@/store/useAppStore";

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
  const modalOpen = useAppStore((state) => state.modalOpen);
  const setLayer = useAppStore((state) => state.setLayer);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (modalOpen || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
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
  }, [modalOpen, setLayer]);

  if (modalOpen) {
    return null;
  }

  return (
    <aside className="pointer-events-auto absolute right-4 top-1/2 z-10 w-[min(220px,calc(100vw-2rem))] -translate-y-1/2 rounded-lg border border-white/10 bg-background/60 p-2.5 shadow-2xl backdrop-blur md:right-6">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-normal text-foreground">Imagery</h2>
        <span className="text-[11px] text-muted-foreground">1-7</span>
      </div>
      <div className="space-y-0.5">
        {imageryProviders.map((provider, index) => {
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
    </aside>
  );
}
