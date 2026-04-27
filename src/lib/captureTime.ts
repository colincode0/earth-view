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
  "viirs-black-marble": {
    localSolarMinutes: 1 * 60 + 30,
    note: "annual nighttime composite",
  },
  "modis-aod": {
    localSolarMinutes: 12 * 60,
    note: "Terra + Aqua daily product",
  },
  "modis-cloud-top-temp": {
    localSolarMinutes: 10 * 60 + 30,
  },
  "amsr2-precipitable-water": {
    localSolarMinutes: 13 * 60 + 30,
    note: "AMSR2 ascending pass",
  },
  "ghrsst-sst": {
    localSolarMinutes: 12 * 60,
    note: "daily L4 composite",
  },
  "modis-chlorophyll": {
    localSolarMinutes: 13 * 60 + 30,
  },
  "modis-snow-cover": {
    localSolarMinutes: 10 * 60 + 30,
  },
  "amsr2-sea-ice": {
    localSolarMinutes: 13 * 60 + 30,
    note: "AMSR2 daily product",
  },
  "viirs-noaa20-fires": {
    localSolarMinutes: 13 * 60 + 25,
    note: "VIIRS daytime thermal pass",
  },
  "modis-fires": {
    localSolarMinutes: 12 * 60,
    note: "Terra + Aqua combined thermal anomalies",
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

export function formatSceneAcquisition(scene: {
  dateTime: string;
  cloudCover: number | null;
}) {
  const cloudSuffix =
    typeof scene.cloudCover === "number" ? ` · ${Math.round(scene.cloudCover)}% cloud` : "";

  return `${formatExactCaptureTime(scene.dateTime)}${cloudSuffix}`;
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
