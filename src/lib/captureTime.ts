import { formatLongDate } from "./dates";

type CaptureTiming = {
  localSolarMinutes: number;
  note?: string;
};

const GIBS_CAPTURE_TIMING: Record<string, CaptureTiming> = {
  "modis-terra": {
    localSolarMinutes: 10 * 60 + 15,
    note: "Terra orbit drift",
  },
  "modis-aqua": {
    localSolarMinutes: 13 * 60 + 30,
    note: "Aqua afternoon orbit",
  },
  "viirs-snpp": {
    localSolarMinutes: 13 * 60 + 30,
  },
  "viirs-noaa20": {
    localSolarMinutes: 13 * 60 + 25,
  },
  "viirs-snpp-swir": {
    localSolarMinutes: 13 * 60 + 30,
  },
  "viirs-snpp-cloud-snow": {
    localSolarMinutes: 13 * 60 + 30,
  },
  "viirs-noaa20-swir": {
    localSolarMinutes: 13 * 60 + 25,
  },
};

const SENTINEL_CAPTURE_TIMING: Record<string, CaptureTiming> = {
  "s2-true-color": {
    localSolarMinutes: 10 * 60 + 30,
  },
  "s2-false-color": {
    localSolarMinutes: 10 * 60 + 30,
  },
  "s2-swir": {
    localSolarMinutes: 10 * 60 + 30,
  },
  "s1-radar": {
    localSolarMinutes: 18 * 60,
    note: "can also pass near dawn",
  },
};

function formatBrowserLocalTime(date: Date) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatExactCaptureTime(value: string) {
  const date = new Date(value);

  return `${new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)} · ${formatBrowserLocalTime(date)}`;
}

function formatLocalSolarTime(totalMinutes: number) {
  const normalizedMinutes = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalizedMinutes / 60);
  const minute = normalizedMinutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function estimatedUtcDate(date: string, lon: number, localSolarMinutes: number) {
  const utcMinutes = localSolarMinutes - lon * 4;
  return new Date(`${date}T00:00:00Z`).getTime() + utcMinutes * 60 * 1000;
}

function formatEstimatedCaptureTime(date: string, timing: CaptureTiming, lon?: number) {
  const localSolar = formatLocalSolarTime(timing.localSolarMinutes);
  const note = timing.note ? ` · ${timing.note}` : "";

  if (lon === undefined) {
    return `${formatLongDate(date)} · est. ${localSolar} local solar${note}`;
  }

  return `${formatLongDate(date)} · est. ${formatBrowserLocalTime(
    new Date(estimatedUtcDate(date, lon, timing.localSolarMinutes)),
  )} (${localSolar} local solar)${note}`;
}

export function formatGibsCaptureTime(date: string, providerId: string, lon?: number) {
  return formatEstimatedCaptureTime(
    date,
    GIBS_CAPTURE_TIMING[providerId] ?? GIBS_CAPTURE_TIMING["viirs-noaa20"],
    lon,
  );
}

export function formatSentinelCaptureTime(date: string, variantId: string, lon?: number) {
  return formatEstimatedCaptureTime(
    date,
    SENTINEL_CAPTURE_TIMING[variantId] ?? SENTINEL_CAPTURE_TIMING["s2-true-color"],
    lon,
  );
}
