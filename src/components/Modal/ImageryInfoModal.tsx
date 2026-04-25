import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sentinelVariants } from "@/lib/sentinelVariants";
import { imageryProviders } from "@/providers/registry";

type ImageryInfoModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ImageryInfoButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className="h-7 px-2 text-xs"
    >
      <Info className="h-3.5 w-3.5" />
      Imagery info
    </Button>
  );
}

export function ImageryInfoModal({ open, onOpenChange }: ImageryInfoModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,760px)]">
        <div className="max-h-[82vh] overflow-y-auto p-5 pr-10">
          <DialogHeader className="mb-5">
            <DialogTitle>Imagery Layers</DialogTitle>
            <DialogDescription>
              GIBS layers are moderate-resolution NASA browse imagery. Some are natural color,
              while others use non-visible bands to reveal fire, snow, ice, vegetation, and water.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {imageryProviders.map((provider) => (
              <section
                key={provider.id}
                className="rounded-md border border-border bg-background/45 p-4"
              >
                <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="text-sm font-semibold">{provider.name}</h3>
                  <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
                    {provider.category}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{provider.summary}</p>
                <p className="mt-2 text-sm">
                  <span className="font-medium text-foreground">Best for:</span>{" "}
                  <span className="text-muted-foreground">{provider.bestFor}</span>
                </p>
                <p className="mt-1 text-sm">
                  <span className="font-medium text-foreground">Watch out:</span>{" "}
                  <span className="text-muted-foreground">{provider.caveat}</span>
                </p>
              </section>
            ))}
          </div>

          <section className="mt-5 rounded-md border border-primary/35 bg-primary/10 p-4">
            <h3 className="text-sm font-semibold">Detailed Sentinel Layers</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Sentinel-2 provides optical detail and Sentinel-1 provides radar imagery for cloudy
              or night scenes. Radar is all-weather, but it is analytical rather than photographic.
            </p>
            <div className="mt-3 space-y-3">
              {sentinelVariants.map((variant) => (
                <section
                  key={variant.id}
                  className="rounded-md border border-border/70 bg-background/60 p-3"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h4 className="text-sm font-semibold">{variant.name}</h4>
                    <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
                      {variant.category}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {variant.resolution}m nominal
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{variant.summary}</p>
                  <p className="mt-1 text-sm">
                    <span className="font-medium text-foreground">Best for:</span>{" "}
                    <span className="text-muted-foreground">{variant.bestFor}</span>
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="font-medium text-foreground">Watch out:</span>{" "}
                    <span className="text-muted-foreground">{variant.caveat}</span>
                  </p>
                </section>
              ))}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
