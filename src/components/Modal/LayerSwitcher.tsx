import { Layers } from "lucide-react";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { imageryProviders } from "@/providers/registry";

type LayerSwitcherProps = {
  value: string;
  onValueChange: (value: string) => void;
  action?: ReactNode;
};

export function LayerSwitcher({ value, onValueChange, action }: LayerSwitcherProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="inline-flex items-center gap-2">
          <Layers className="h-3.5 w-3.5" />
          Imagery
        </Label>
        {action}
      </div>
      <div className="space-y-1">
        {imageryProviders.map((provider, index) => {
          const selected = provider.id === value;

          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => onValueChange(provider.id)}
              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                selected
                  ? "border-primary/60 bg-primary/15 text-foreground"
                  : "border-border/40 bg-background/35 text-muted-foreground hover:border-border hover:bg-background/70 hover:text-foreground"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border text-[11px] font-semibold ${
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background/70 text-muted-foreground"
                }`}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{provider.name}</span>
                <span className="block truncate text-[11px] opacity-75">{provider.category}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
