import { Bot, Film, LoaderCircle, MapPinned, Satellite } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCoordinates } from "@/lib/geo";
import {
  formatExactCaptureTime,
  formatGibsCaptureTime,
  formatSentinelCaptureTime,
  formatSceneAcquisition,
} from "@/lib/captureTime";
import { getImageryProvider, modalImageryProviders } from "@/providers/registry";
import { useAppStore } from "@/store/useAppStore";
import { DatePicker } from "./DatePicker";
import { ImageryInfoButton, ImageryInfoModal } from "./ImageryInfoModal";
import {
  TIME_LAPSE_SPEEDS,
} from "./hooks/imageryModalHelpers";
import { useModalPaneSize } from "./hooks/useModalPaneSize";
import { useObjectUrls } from "./hooks/useObjectUrls";
import { useRegionalImagery } from "./hooks/useRegionalImagery";
import { useTimeLapse } from "./hooks/useTimeLapse";
import { AskViewModal, type AskProvider, type AskViewContext } from "./AskViewModal";
import { LayerSwitcher } from "./LayerSwitcher";
import { TimeLapseModal } from "./TimeLapseModal";

function viewSignature(context: AskViewContext | null, imageUrl: string | null) {
  if (!context || !imageUrl) {
    return "";
  }

  return JSON.stringify({
    imageUrl,
    providerId: context.providerId,
    date: context.date,
    lat: Number(context.lat.toFixed(5)),
    lon: Number(context.lon.toFixed(5)),
    bbox: context.bbox
      ? {
          minLat: Number(context.bbox.minLat.toFixed(5)),
          minLon: Number(context.bbox.minLon.toFixed(5)),
          maxLat: Number(context.bbox.maxLat.toFixed(5)),
          maxLon: Number(context.bbox.maxLon.toFixed(5)),
        }
      : null,
    zoom: Number(context.imageryZoomDegrees.toFixed(5)),
  });
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
  const [infoOpen, setInfoOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askProvider, setAskProvider] = useState<AskProvider>("openai");
  const [askPrompt, setAskPrompt] = useState("");
  const provider = getImageryProvider(layerId);
  const selectedLon = selectedPoint?.lon;
  const isRegionalSentinel = Boolean(provider.sentinelVariantId);
  const regionalLoadingMessage = provider.loadingMessage ?? "Loading imagery";
  const regionalUpdatingMessage = provider.loadingMessage
    ? `Updating. ${provider.loadingMessage}`
    : "Updating";
  const { imagePaneRef, imagePaneSize, setImagePaneRef } = useModalPaneSize(modalOpen);
  const { createObjectUrl, revokeObjectUrl } = useObjectUrls();
  const regionalImagery = useRegionalImagery({
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
    revokeObjectUrl,
  });
  const timeLapse = useTimeLapse({
    bbox: regionalImagery.bbox,
    date,
    provider,
    createObjectUrl,
    revokeObjectUrl,
  });

  useEffect(() => {
    if (!modalOpen) {
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

      if (!Number.isInteger(index) || index < 0 || index >= modalImageryProviders.length) {
        return;
      }

      event.preventDefault();
      setLayer(modalImageryProviders[index].id);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen, setLayer]);

  const coordinates = selectedPoint
    ? formatCoordinates(selectedPoint.lat, selectedPoint.lon)
    : "";
  const regionalCaptureLabel = formatGibsCaptureTime(date, provider.id, selectedLon);
  const acquiredScenes = regionalImagery.acquiredScenes;
  const mostRecentSceneTime = acquiredScenes[0]?.dateTime ?? null;
  const regionalProviderCaptureLabel = provider.sentinelVariantId
    ? mostRecentSceneTime
      ? acquiredScenes.length > 1
        ? `${formatExactCaptureTime(mostRecentSceneTime)} · ${acquiredScenes.length} scene mosaic`
        : formatExactCaptureTime(mostRecentSceneTime)
      : formatSentinelCaptureTime(date, provider.sentinelVariantId, selectedLon)
    : regionalCaptureLabel;
  const captureLabel = regionalProviderCaptureLabel;
  const askViewContext: AskViewContext | null = selectedPoint
    ? {
        coordinates,
        lat: selectedPoint.lat,
        lon: selectedPoint.lon,
        date,
        captureLabel,
        providerName: provider.name,
        providerId: provider.id,
        satellite: provider.satellite,
        category: provider.category,
        resolutionMeters: provider.resolution,
        sentinelVariantId: provider.sentinelVariantId,
        bbox: regionalImagery.bbox,
        imageryZoomDegrees,
        imageWidth: imagePaneSize?.width ?? null,
        imageHeight: imagePaneSize?.height ?? null,
      }
    : null;
  const askViewSignature = viewSignature(askViewContext, regionalImagery.imageUrl);

  function handleOpenChange(open: boolean) {
    if (open) {
      return;
    }

    setAskOpen(false);
    closeModal();
  }

  return (
    <Dialog open={modalOpen} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="imagery-modal">
        <div className="grid max-h-[92dvh] grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
          <div
            ref={setImagePaneRef}
            className="relative min-h-[360px] overflow-hidden bg-black lg:min-h-[680px]"
          >
            {regionalImagery.imageUrl ? (
              <img
                key={regionalImagery.imageUrl}
                src={regionalImagery.imageUrl}
                alt=""
                data-testid="gibs-image"
                draggable={false}
                className="h-full w-full cursor-grab select-none object-cover active:cursor-grabbing"
                style={{
                  transform: `translate(${regionalImagery.regionalPan.x}px, ${regionalImagery.regionalPan.y}px) scale(${regionalImagery.imagePreviewScale})`,
                  transformOrigin: "center",
                  transition:
                    regionalImagery.regionalDragStart || regionalImagery.imageLoading
                      ? "none"
                      : "transform 160ms ease-out",
                }}
                onWheel={regionalImagery.zoomRegionalImage}
                onPointerDown={(event) => {
                  if (event.shiftKey) {
                    const point = regionalImagery.pointFromRegionalEvent(event);

                    if (point) {
                      recenterPoint(point.lat, point.lon);
                    }

                    return;
                  }

                  event.currentTarget.setPointerCapture(event.pointerId);
                  regionalImagery.setRegionalDragStart({
                    pointerId: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    originX: regionalImagery.committedRegionalPan.x,
                    originY: regionalImagery.committedRegionalPan.y,
                  });
                }}
                onPointerMove={(event) => {
                  if (
                    !regionalImagery.regionalDragStart ||
                    regionalImagery.regionalDragStart.pointerId !== event.pointerId
                  ) {
                    return;
                  }

                  regionalImagery.setRegionalPan({
                    x: regionalImagery.regionalDragStart.originX + event.clientX - regionalImagery.regionalDragStart.x,
                    y: regionalImagery.regionalDragStart.originY + event.clientY - regionalImagery.regionalDragStart.y,
                  });
                }}
                onPointerUp={(event) => {
                  const nextPan = regionalImagery.regionalDragStart
                    ? {
                        x: regionalImagery.regionalDragStart.originX + event.clientX - regionalImagery.regionalDragStart.x,
                        y: regionalImagery.regionalDragStart.originY + event.clientY - regionalImagery.regionalDragStart.y,
                      }
                    : regionalImagery.regionalPan;

                  regionalImagery.setRegionalDragStart(null);
                  regionalImagery.commitRegionalPan(nextPan);
                }}
                onPointerCancel={() => {
                  regionalImagery.setRegionalDragStart(null);
                  regionalImagery.setRegionalPan(regionalImagery.committedRegionalPan);
                }}
                onLoad={() => regionalImagery.setImageLoading(false)}
                onError={() => {
                  regionalImagery.setError("Imagery unavailable for this selection.");
                  regionalImagery.setImageLoading(false);
                }}
              />
            ) : null}
            {!regionalImagery.imageUrl && regionalImagery.imageLoading && !regionalImagery.error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                <div className="flex items-center gap-2 rounded-md border border-white/10 bg-background/80 px-3 py-2 text-sm shadow-xl backdrop-blur">
                  <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                  {regionalLoadingMessage}
                </div>
              </div>
            )}
            {regionalImagery.imageUrl && regionalImagery.imageLoading && !regionalImagery.error && (
              <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-md border border-white/10 bg-black/65 px-2.5 py-1.5 text-xs text-white/85 shadow-xl backdrop-blur">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
                {isRegionalSentinel
                  ? regionalImagery.updateReason === "positioning"
                    ? "Updating positioning"
                    : "Updating resolution"
                  : regionalUpdatingMessage}
              </div>
            )}
            {regionalImagery.error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-8 text-center text-sm text-muted-foreground">
                {regionalImagery.error}
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
                {provider.name}
              </div>
              <div className="text-sm text-muted-foreground">
                {`${provider.satellite} · ${provider.resolution}m nominal${
                  provider.requiresAuth ? " · Copernicus" : ""
                }`}
              </div>
              {isRegionalSentinel && acquiredScenes.length > 1 && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Scenes in mosaic
                  </div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {acquiredScenes.map((scene) => (
                      <li key={scene.dateTime} className="font-mono">
                        {formatSceneAcquisition(scene)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <>
                <div className="space-y-2 rounded-md border border-border bg-background/35 p-3">
                  <Select
                    value={askProvider}
                    onValueChange={(value) => setAskProvider(value as AskProvider)}
                  >
                    <SelectTrigger aria-label="AI provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                    </SelectContent>
                  </Select>
                  <textarea
                    value={askPrompt}
                    onChange={(event) => setAskPrompt(event.target.value)}
                    rows={3}
                    placeholder="Optional focus or context for the initial analysis"
                    className="min-h-20 w-full resize-none rounded-md border border-input bg-background/70 px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setAskOpen(true)}
                    disabled={!regionalImagery.imageUrl || regionalImagery.imageLoading}
                    className="w-full"
                  >
                    <Bot className="h-4 w-4" />
                    Ask about this view
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void (
                      isRegionalSentinel
                        ? timeLapse.loadRegionalSentinelTimeLapse(7)
                        : timeLapse.loadTimeLapse(7)
                    )}
                    disabled={timeLapse.timeLapseLoading || !regionalImagery.bbox}
                    className="w-full"
                  >
                    {timeLapse.timeLapseLoading && timeLapse.timeLapseMode === 7 ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Film className="h-4 w-4" />
                    )}
                    {isRegionalSentinel ? "7 scenes" : "7 days"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void (
                      isRegionalSentinel
                        ? timeLapse.loadRegionalSentinelTimeLapse(30)
                        : timeLapse.loadTimeLapse(30)
                    )}
                    disabled={timeLapse.timeLapseLoading || !regionalImagery.bbox}
                    className="w-full"
                  >
                    {timeLapse.timeLapseLoading && timeLapse.timeLapseMode === 30 ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Film className="h-4 w-4" />
                    )}
                    {isRegionalSentinel ? "30 scenes" : "30 days"}
                  </Button>
                </div>

                {isRegionalSentinel && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void timeLapse.loadRegionalSentinelFiveYearTimeLapse()}
                    disabled={timeLapse.timeLapseLoading || !regionalImagery.bbox}
                    className="w-full"
                  >
                    {timeLapse.timeLapseLoading && timeLapse.timeLapseMode === "5y" ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Film className="h-4 w-4" />
                    )}
                    Last 5 years
                  </Button>
                )}

                <LayerSwitcher
                  value={layerId}
                  onValueChange={setLayer}
                  action={<ImageryInfoButton onClick={() => setInfoOpen(true)} />}
                />
                <DatePicker value={date} onChange={setDate} />
              </>
          </aside>
        </div>
      </DialogContent>
      <AskViewModal
        open={askOpen}
        onOpenChange={setAskOpen}
        askProvider={askProvider}
        initialQuestion={askPrompt}
        imageUrl={regionalImagery.imageUrl}
        viewContext={askViewContext}
        viewSignature={askViewSignature}
      />
      <ImageryInfoModal open={infoOpen} onOpenChange={setInfoOpen} />
      <TimeLapseModal
        open={timeLapse.timeLapseOpen}
        onOpenChange={timeLapse.setTimeLapseOpen}
        frames={timeLapse.timeLapseFrames}
        loading={timeLapse.timeLapseLoading}
        loadingProgress={timeLapse.timeLapseLoadingProgress}
        error={timeLapse.timeLapseError}
        title={
          isRegionalSentinel
            ? `${provider.name} · ${
                timeLapse.timeLapseMode === "5y" ? "Last 5 years" : `${timeLapse.timeLapseMode} scenes`
              }`
            : `${provider.name} · ${timeLapse.timeLapseMode} days`
        }
        frameCountLabel={isRegionalSentinel ? "scene frames" : undefined}
        frameIntervalMs={TIME_LAPSE_SPEEDS[timeLapse.timeLapseMode]}
        allowSequenceDownload={isRegionalSentinel}
      />
    </Dialog>
  );
}
