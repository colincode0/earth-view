import { LoaderCircle, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatExactCaptureTime } from "@/lib/captureTime";
import { formatLongDate } from "@/lib/dates";

export type TimeLapseFrame = {
  date: string;
  imageUrl: string;
};

type TimeLapseModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  frames: TimeLapseFrame[];
  loading: boolean;
  error: string | null;
  title: string;
  frameCountLabel?: string;
  frameIntervalMs: number;
};

function formatFrameDate(value: string) {
  if (value.includes("T")) {
    return formatExactCaptureTime(value);
  }

  return formatLongDate(value);
}

export function TimeLapseModal({
  open,
  onOpenChange,
  frames,
  loading,
  error,
  title,
  frameCountLabel = "daily frames",
  frameIntervalMs,
}: TimeLapseModalProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const frameCount = frames.length;
  const currentFrame = frames[frameIndex] ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }

    setFrameIndex(0);
    setPlaying(true);
  }, [open, frames]);

  useEffect(() => {
    if (!open || !playing || frameCount <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setFrameIndex((index) => (index + 1) % frameCount);
    }, frameIntervalMs);

    return () => window.clearInterval(timer);
  }, [frameCount, frameIntervalMs, open, playing]);

  function step(delta: number) {
    if (frameCount === 0) {
      return;
    }

    setFrameIndex((index) => (index + delta + frameCount) % frameCount);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,980px)]">
        <div className="grid max-h-[88vh] grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="relative min-h-[340px] bg-black lg:min-h-[620px]">
            {currentFrame ? (
              <img
                key={currentFrame.imageUrl}
                src={currentFrame.imageUrl}
                alt=""
                draggable={false}
                className="h-full w-full select-none object-cover"
              />
            ) : null}

            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <div className="flex items-center gap-2 rounded-md border border-white/10 bg-background/80 px-3 py-2 text-sm shadow-xl backdrop-blur">
                  <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                  Loading frames
                </div>
              </div>
            )}

            {error && !loading && !currentFrame && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/75 p-8 text-center text-sm text-muted-foreground">
                {error}
              </div>
            )}

            {currentFrame && (
              <div className="absolute right-3 top-3 rounded-md border border-white/10 bg-black/55 px-2 py-1 text-xs text-white/85 backdrop-blur">
                {formatFrameDate(currentFrame.date)}
              </div>
            )}
          </div>

          <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-t border-border bg-card p-5 lg:border-l lg:border-t-0">
            <DialogHeader className="pr-7">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {frameCount > 0 ? `${frameCount} ${frameCountLabel}` : `Preparing ${frameCountLabel}`}
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => step(-1)}
                disabled={frameCount === 0}
                aria-label="Previous frame"
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPlaying((value) => !value)}
                disabled={frameCount <= 1}
                className="flex-1"
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {playing ? "Pause" : "Play"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => step(1)}
                disabled={frameCount === 0}
                aria-label="Next frame"
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>

            <input
              type="range"
              min={0}
              max={Math.max(0, frameCount - 1)}
              value={frameIndex}
              disabled={frameCount <= 1}
              onChange={(event) => setFrameIndex(Number(event.target.value))}
              className="w-full accent-primary"
            />

            <div className="rounded-md border border-border bg-background/45 p-3 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">
                {currentFrame ? formatFrameDate(currentFrame.date) : "No frame loaded"}
              </div>
              <div className="mt-1">
                {frameCount > 0 ? `Frame ${frameIndex + 1} of ${frameCount}` : "Waiting for imagery"}
              </div>
              {error && currentFrame && <div className="mt-2 text-xs text-amber-300">{error}</div>}
            </div>

            <div className="space-y-1">
              {frames.map((frame, index) => (
                <button
                  key={frame.date}
                  type="button"
                  onClick={() => setFrameIndex(index)}
                  className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-xs transition-colors ${
                    index === frameIndex
                      ? "border-primary/60 bg-primary/15 text-foreground"
                      : "border-border/40 bg-background/35 text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  <span>{formatFrameDate(frame.date)}</span>
                  <span>{index + 1}</span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
