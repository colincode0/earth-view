import { CalendarDays } from "lucide-react";
import { Label } from "@/components/ui/label";
import { MODIS_TERRA_START, getLatestTrueColorImagery } from "@/lib/dates";

type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
};

export function DatePicker({ value, onChange }: DatePickerProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="imagery-date" className="inline-flex items-center gap-2">
        <CalendarDays className="h-3.5 w-3.5" />
        Date
      </Label>
      <input
        id="imagery-date"
        type="date"
        min={MODIS_TERRA_START}
        max={getLatestTrueColorImagery().date}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background/70 px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      />
    </div>
  );
}
